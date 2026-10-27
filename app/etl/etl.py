"""ETL: CrateDB (crudo) -> limpiar -> detectar atipicos -> analizar -> Postgres (DWH) + alertas a Orion.

MEJORAS DE RECURSIVIDAD Y DESACOPLAMIENTO DE DESPLIEGUE:
1. Extracción y procesamiento RECURSIVO por lotes (divide y drena backlog completo sin depender de ciclos).
2. Imputación RECURSIVA de micro-huecos mediante divide y vencerás.
3. Desacoplado para despliegue: soporte para modo '--deploy' o '--once' que procesa todo a fondo
   y termina inmediatamente con código 0, sin obligar al despliegue a esperar un bucle de 5 minutos.
4. Notificación en tiempo real al WebSocket de la API para avisar al frontend inmediatamente.
"""
from __future__ import annotations

import argparse
import os
import statistics
import sys
import time
from collections import defaultdict, deque
from typing import Any

try:
    import psycopg
except ImportError:
    psycopg = None

try:
    import requests
except ImportError:
    requests = None

CRATE_URL = os.environ.get("CRATE_URL", "http://crate-db:4200/_sql")
TABLE = os.environ.get("CRATE_TABLE", "mtopeniot.etplantsensor")
DSN = os.environ.get("DWH_DSN", "postgresql://dwh:dwh@localhost:5432/plantas")
ORION = os.environ.get("ORION_URL", "http://orion:1026")
API_URL = os.environ.get("API_URL", "http://api:8000")
CRATE_AUTH = (os.environ.get("CRATE_USER", "iot"), os.environ.get("CRATE_PASSWORD", ""))
INTERVAL = int(os.environ.get("ETL_INTERVAL_SECONDS", "300"))
SIN_DATOS_MIN = int(os.environ.get("SIN_DATOS_MINUTOS", "15"))
ZONA = os.environ.get("ZONA_HORARIA", "America/Bogota")
SCHEMA_FILE = os.environ.get("SCHEMA_FILE", "/schema/init.sql")
FIWARE_HEADERS = {"fiware-service": "openiot", "fiware-servicepath": "/"}
BATCH_SIZE = int(os.environ.get("ETL_BATCH_SIZE", "1000"))

# Rangos fisicos validos (limpiar) y umbrales recomendados (analizar).
VALID = {"temperature": (-10, 60), "humidity": (0, 100), "luminosity": (0, 120000), "soil_moisture": (0, 100)}
WARN = {"temperature": (10, 35), "humidity": (30, 90), "luminosity": (1000, 80000), "soil_moisture": (20, 80)}

# Atipicos (temperatura y humedad): |v - mediana| > max(K * MAD, delta minimo)
OUTLIER_MIN_DELTA = {"temperature": 6.0, "humidity": 20.0}
OUTLIER_K = 5
VENTANA = 20
DEDUP_MIN = 30

NOMBRE = {"temperature": "temperatura", "humidity": "humedad del aire",
          "luminosity": "luminosidad", "soil_moisture": "humedad del suelo"}
UNIDAD = {"temperature": "°C", "humidity": "%", "luminosity": "lx", "soil_moisture": "%"}

ventanas = defaultdict(lambda: deque(maxlen=VENTANA))  # (entity_id, variable) -> valores recientes


# ---------------- Extraer ----------------
def extract(since_ms: int, limit: int = BATCH_SIZE) -> list[list[Any]]:
    """Extrae un lote de lecturas crudas posteriores a since_ms desde CrateDB."""
    q = (f"SELECT entity_id, time_index, temperature, humidity, luminosity, soilmoisture "
         f"FROM {TABLE} WHERE time_index > ? ORDER BY time_index LIMIT {limit}")
    try:
        r = requests.post(CRATE_URL, json={"stmt": q, "args": [since_ms]}, auth=CRATE_AUTH, timeout=30)
        if r.status_code == 404 or "TableUnknownException" in r.text:
            return []  # la tabla aun no existe: QuantumLeap la crea con la primera lectura
        r.raise_for_status()
        return r.json().get("rows", [])
    except requests.RequestException as e:
        print(f"Aviso al extraer de CrateDB ({CRATE_URL}): {e}", flush=True)
        return []


# ---------------- Limpiar ----------------
def es_atipico(eid: str, k: str, v: float) -> bool:
    w = ventanas[(eid, k)]
    if len(w) < 5:
        return False
    med = statistics.median(w)
    mad = statistics.median(abs(x - med) for x in w)
    return abs(v - med) > max(OUTLIER_K * mad, OUTLIER_MIN_DELTA[k])


def clean(rows: list[list[Any]]) -> list[tuple[str, int, dict[str, Any], dict[str, Any]]]:
    out = []
    for eid, ts, t, h, lx, s in rows:
        vals = {"temperature": t, "humidity": h, "luminosity": lx, "soil_moisture": s}
        flags = {}
        for k, v in vals.items():
            if v is None or not VALID[k][0] <= v <= VALID[k][1]:
                vals[k], flags[k] = None, ("invalido", v)
                continue
            if k in OUTLIER_MIN_DELTA:
                if es_atipico(eid, k, v):
                    vals[k], flags[k] = None, ("atipico", v)
                ventanas[(eid, k)].append(v)
        out.append((eid, ts, vals, flags))
    return out


# ---------------- Imputar (Interpolación Lineal Recursiva) ----------------
MAX_IMPUTE_GAP_MS = 120 * 1000
last_valid: dict[tuple[str, str], tuple[int, float]] = {}


def _interpolar_recursivo(puntos: list[list[Any]], i: int, j: int, max_gap_ms: int) -> None:
    """Interpola recursivamente usando divide y vencerás sobre el intervalo [i, j].
    
    Caso base: j - i <= 1 (no hay puntos intermedios a interpolar).
    Paso recursivo: interpola el punto medio y divide recursivamente a izquierda y derecha.
    """
    if j - i <= 1:
        return

    t_prev, v_prev = puntos[i][1], puntos[i][2]
    t_next, v_next = puntos[j][1], puntos[j][2]

    # Si el salto temporal excede el límite permitido, no interpolar (evitar extrapolación)
    if t_next - t_prev > max_gap_ms:
        return

    mid = (i + j) // 2
    if puntos[mid][2] is None:
        t_mid = puntos[mid][1]
        frac = (t_mid - t_prev) / (t_next - t_prev)
        v_mid = v_prev + frac * (v_next - v_prev)
        puntos[mid][2] = v_mid

    # Llamadas recursivas para subdividir ambas mitades
    _interpolar_recursivo(puntos, i, mid, max_gap_ms)
    _interpolar_recursivo(puntos, mid, j, max_gap_ms)


def impute(rows: list[tuple[str, int, dict[str, Any], dict[str, Any]]]) -> list[tuple[str, int, dict[str, Any], dict[str, Any], bool]]:
    """Aplica imputación lineal recursiva a los micro-huecos de telemetría."""
    if not rows:
        return []

    by_entity: dict[str, list[tuple[int, int, dict[str, Any], dict[str, Any]]]] = defaultdict(list)
    for idx, (eid, ts, vals, flags) in enumerate(rows):
        by_entity[eid].append((idx, ts, vals, flags))

    out: list[Any] = [None] * len(rows)

    for eid, e_rows in by_entity.items():
        for var in ["temperature", "humidity", "luminosity", "soil_moisture"]:
            # puntos como lista mutable: [orig_idx, ts, val]
            puntos = [[idx, ts, vals[var]] for idx, ts, vals, _ in e_rows]

            # Si el primer punto es nulo, enlazar con el último valor válido recordado
            if puntos and puntos[0][2] is None and (eid, var) in last_valid:
                prev_ts, prev_val = last_valid[(eid, var)]
                puntos.insert(0, [-1, prev_ts, prev_val])
                offset = 1
            else:
                offset = 0

            # Encontrar índices con valores válidos y procesar cada hueco recursivamente
            indices_validos = [i for i, p in enumerate(puntos) if p[2] is not None]
            for k in range(len(indices_validos) - 1):
                idx_a = indices_validos[k]
                idx_b = indices_validos[k + 1]
                if idx_b - idx_a > 1:
                    _interpolar_recursivo(puntos, idx_a, idx_b, MAX_IMPUTE_GAP_MS)

            # Reintegrar los puntos calculados a las filas
            for p in puntos[offset:]:
                orig_idx, ts, val = p[0], p[1], p[2]
                if val is not None:
                    last_valid[(eid, var)] = (ts, val)
                    dec = 1 if var == "temperature" else 0
                    val_redondeado = round(val, dec)
                    vals_ref = e_rows[orig_idx][2]
                    flags_ref = e_rows[orig_idx][3]
                    if vals_ref[var] is None:
                        vals_ref[var] = val_redondeado
                        flags_ref[f"{var}_imputado"] = ("imputado", val_redondeado)

        for idx, ts, vals, flags in e_rows:
            es_imp = any(k.endswith("_imputado") for k in flags)
            out[idx] = (eid, ts, vals, flags, es_imp)

    return out


# ---------------- Analizar ----------------
def analyze(rows: list[tuple[str, int, dict[str, Any], dict[str, Any], bool]]) -> list[tuple[str, int, str, str, str, str]]:
    alerts = []
    for eid, ts, vals, flags, _ in rows:
        for k in ["temperature", "humidity", "luminosity", "soil_moisture"]:
            v = vals[k]
            n, u = NOMBRE[k], UNIDAD[k]
            lo, hi = WARN[k]
            if k in flags:
                motivo, crudo = flags[k]
                if f"{k}_imputado" in flags:
                    v_imp = flags[f"{k}_imputado"][1]
                    alerts.append((eid, ts, "warning", k, f"{k}_imputado",
                                   f"Lectura de {n} ausente o inválida ({crudo}): estimada por interpolación ({v_imp} {u})"))
                elif motivo == "invalido":
                    det = "ausente" if crudo is None else f"fuera de rango físico ({crudo})"
                    alerts.append((eid, ts, "error", k, f"{k}_invalido",
                                   f"Lectura de {n} inválida: {det}. Posible falla o desconexión del sensor"))
                else:
                    alerts.append((eid, ts, "warning", k, f"{k}_atipico",
                                   f"Valor atípico de {n} descartado: {crudo:.1f} {u} (cambio brusco)"))
            elif v is not None:
                if v < lo:
                    alerts.append((eid, ts, "warning", k, f"{k}_bajo",
                                   f"{n.capitalize()} baja: {v:.1f} {u} (mínimo recomendado {lo} {u})"))
                elif v > hi:
                    alerts.append((eid, ts, "warning", k, f"{k}_alto",
                                   f"{n.capitalize()} alta: {v:.1f} {u} (máximo recomendado {hi} {u})"))
    return alerts


# ---------------- Cargar ----------------
def insert_alert(cur: Any, eid: str, ts_ms: int, sev: str, var: str | None, tipo: str, msg: str, dedup_min: int = DEDUP_MIN) -> bool:
    cur.execute(
        "INSERT INTO alerta(entity_id, ts, severidad, variable, tipo, mensaje) "
        "SELECT %s, to_timestamp(%s/1000.0), %s, %s, %s, %s "
        "WHERE NOT EXISTS (SELECT 1 FROM alerta WHERE entity_id=%s AND tipo=%s "
        "  AND ts > to_timestamp(%s/1000.0) - make_interval(mins => %s::int)) "
        "ON CONFLICT DO NOTHING RETURNING id",
        (eid, ts_ms, sev, var, tipo, msg, eid, tipo, ts_ms, dedup_min))
    return cur.fetchone() is not None


def load(cur: Any, rows: list[Any], alerts: list[Any], since_ms: int) -> list[Any]:
    if not rows:
        return []

    cur.executemany(
        """INSERT INTO lectura_limpia(entity_id, ts, temperature, humidity, luminosity, soil_moisture, es_imputado)
           VALUES (%s, to_timestamp(%s/1000.0), %s, %s, %s, %s, %s)
           ON CONFLICT (entity_id, ts) DO UPDATE SET
             temperature = EXCLUDED.temperature,
             humidity = EXCLUDED.humidity,
             luminosity = EXCLUDED.luminosity,
             soil_moisture = EXCLUDED.soil_moisture,
             es_imputado = EXCLUDED.es_imputado""",
        [(e, ts, v["temperature"], v["humidity"], v["luminosity"], v["soil_moisture"], imp) for e, ts, v, _, imp in rows])

    nuevas = [a for a in alerts if insert_alert(cur, *a)]

    cur.execute("""
        INSERT INTO resumen_horario
        SELECT entity_id, date_trunc('hour', ts), avg(temperature), min(temperature), max(temperature),
               avg(humidity), avg(luminosity), avg(soil_moisture), count(*)
        FROM lectura_limpia WHERE ts >= date_trunc('hour', to_timestamp(%s/1000.0)) GROUP BY 1, 2
        ON CONFLICT (entity_id, hora) DO UPDATE SET temp_avg=EXCLUDED.temp_avg, temp_min=EXCLUDED.temp_min,
          temp_max=EXCLUDED.temp_max, hum_avg=EXCLUDED.hum_avg, lux_avg=EXCLUDED.lux_avg,
          soil_avg=EXCLUDED.soil_avg, n=EXCLUDED.n""", (since_ms,))

    cur.execute("""
        INSERT INTO resumen_diario
        SELECT entity_id, ts::date, avg(temperature), min(temperature), max(temperature),
               avg(humidity), min(humidity), max(humidity), avg(luminosity), max(luminosity),
               avg(soil_moisture), min(soil_moisture), count(*)
        FROM lectura_limpia WHERE ts >= date_trunc('day', to_timestamp(%s/1000.0)) GROUP BY 1, 2
        ON CONFLICT (entity_id, dia) DO UPDATE SET temp_avg=EXCLUDED.temp_avg, temp_min=EXCLUDED.temp_min,
          temp_max=EXCLUDED.temp_max, hum_avg=EXCLUDED.hum_avg, hum_min=EXCLUDED.hum_min,
          hum_max=EXCLUDED.hum_max, lux_avg=EXCLUDED.lux_avg, lux_max=EXCLUDED.lux_max,
          soil_avg=EXCLUDED.soil_avg, soil_min=EXCLUDED.soil_min, n=EXCLUDED.n""", (since_ms,))

    return nuevas


# ---------------- Watchdog & Feedback ----------------
def check_sin_datos(cur: Any) -> list[Any]:
    cur.execute("""
        SELECT l.entity_id, max(l.ts) AS ultima FROM lectura_limpia l GROUP BY 1
        HAVING max(l.ts) < now() - make_interval(mins => %s::int)
           AND NOT EXISTS (SELECT 1 FROM alerta a WHERE a.entity_id = l.entity_id
                           AND a.tipo = 'sin_datos' AND a.ts > max(l.ts))""", (SIN_DATOS_MIN,))
    nuevas = []
    for eid, ultima in cur.fetchall():
        a = (eid, int(time.time() * 1000), "error", None, "sin_datos",
             f"El sensor no envía datos desde {ultima.strftime('%Y-%m-%d %H:%M')} (revisar energía o WiFi)")
        if insert_alert(cur, *a, dedup_min=0):
            nuevas.append(a)
    return nuevas


def notify_orion(alerts: list[Any]) -> None:
    ultimas = {a[0]: a for a in alerts}
    for eid, ts, sev, var, tipo, msg in ultimas.values():
        try:
            requests.post(f"{ORION}/v2/entities?options=upsert", headers=FIWARE_HEADERS, timeout=10, json={
                "id": f"Alert:{eid}", "type": "PlantAlert",
                "severity": {"type": "Text", "value": sev},
                "category": {"type": "Text", "value": tipo},
                "message": {"type": "Text", "value": msg},
                "dateIssued": {"type": "DateTime", "value": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts / 1000))},
                "refPlant": {"type": "Text", "value": eid}})
        except requests.RequestException as e:
            print("Aviso: no se pudo publicar la alerta en Orion:", e, flush=True)


def notificar_websocket(tipo: str, titulo: str, mensaje: str, severidad: str = "info", datos: dict[str, Any] | None = None) -> None:
    """Envía la notificación al endpoint de la API para ser transmitida por WebSocket al frontend."""
    try:
        url = f"{API_URL}/api/notificaciones/emitir"
        payload = {
            "tipo": tipo,
            "titulo": titulo,
            "mensaje": mensaje,
            "severidad": severidad,
            "ts": datetime_iso_actual(),
            "datos": datos or {},
        }
        requests.post(url, json=payload, timeout=5)
    except Exception as e:
        # Silencioso si la API aún no está levantada
        pass


def datetime_iso_actual() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ---------------- Procesamiento Recursivo ----------------
def procesar_lote_recursivo(cur: Any, since_ms: int, stats: dict[str, Any] | None = None, profundidad: int = 0, max_profundidad: int = 50) -> dict[str, Any]:
    """Extrae y procesa lotes de datos de manera recursiva hasta agotar todo el backlog en CrateDB.
    
    Caso Base 1: Alcanzada la profundidad máxima de recursión (protección contra desbordamiento).
    Caso Base 2: extract(since_ms) retorna vacío (no hay datos pendientes).
    Paso Recursivo: Limpia, imputa recursivamente, carga en Postgres y llama a procesar_lote_recursivo
                    con el timestamp más reciente para procesar el siguiente lote.
    """
    if stats is None:
        stats = {"lotes": 0, "lecturas": 0, "imputadas": 0, "alertas": [], "ultimo_ts": since_ms}

    if profundidad >= max_profundidad:
        print(f"ETL recursivo: alcanzada profundidad máxima ({max_profundidad})", flush=True)
        return stats

    batch = extract(since_ms, limit=BATCH_SIZE)
    if not batch:
        return stats  # Caso base: no hay más datos por procesar

    cleaned = clean(batch)
    imputed = impute(cleaned)
    nuevas_alertas = load(cur, imputed, analyze(imputed), since_ms)

    n_imp = sum(1 for r in imputed if r[4])
    max_ts = max(r[1] for r in batch)

    stats["lotes"] += 1
    stats["lecturas"] += len(imputed)
    stats["imputadas"] += n_imp
    stats["alertas"].extend(nuevas_alertas)
    stats["ultimo_ts"] = max_ts

    # Caso base: si el lote obtenido fue menor al límite, CrateDB ya no tiene registros posteriores
    if len(batch) < BATCH_SIZE:
        return stats

    # Paso recursivo: avanzar recursivamente hacia el siguiente bloque
    return procesar_lote_recursivo(cur, max_ts, stats, profundidad + 1, max_profundidad)


def ejecutar_etl(conn: psycopg.Connection, modo: str = "daemon") -> dict[str, Any]:
    """Ejecuta una corrida completa del ETL usando procesamiento recursivo."""
    cur = conn.cursor()
    cur.execute("SELECT coalesce(max(extract(epoch FROM ts))*1000, 0)::bigint FROM lectura_limpia")
    since_inicial = cur.fetchone()[0]

    stats = procesar_lote_recursivo(cur, since_inicial)
    alertas_watchdog = check_sin_datos(cur)
    stats["alertas"].extend(alertas_watchdog)

    if stats["alertas"]:
        notify_orion(stats["alertas"])
        # Emitir notificación al WebSocket del frontend si se detectaron alertas
        for a in stats["alertas"]:
            eid, _, sev, var, tipo, msg = a
            notificar_websocket(
                tipo="alerta",
                titulo=f"Alerta en {eid}: {tipo}",
                mensaje=msg,
                severidad=sev,
                datos={"planta_id": eid, "variable": var, "tipo": tipo},
            )

    # Persistir predicciones de siguientes días en PostgreSQL (prediccion_diaria)
    try:
        import predictivo
        cur.execute("SELECT DISTINCT entity_id FROM lectura_limpia")
        entidades = [r[0] for r in cur.fetchall()]
        for eid in entidades:
            cur.execute(
                "SELECT ts, soil_moisture, temperature, humidity, luminosity "
                "FROM lectura_limpia WHERE entity_id=%s AND soil_moisture IS NOT NULL "
                "AND ts >= now() - interval '36 hours' "
                "ORDER BY ts DESC LIMIT 1200", (eid,)
            )
            filas_raw = cur.fetchall()
            if len(filas_raw) < 10:
                cur.execute(
                    "SELECT ts, soil_moisture, temperature, humidity, luminosity "
                    "FROM lectura_limpia WHERE entity_id=%s AND soil_moisture IS NOT NULL "
                    "ORDER BY ts DESC LIMIT 300", (eid,)
                )
                filas_raw = cur.fetchall()
            filas = [{"ts": r[0], "soil_moisture": r[1], "temperature": r[2], "humidity": r[3], "luminosity": r[4]} for r in filas_raw]
            if filas:
                pred = predictivo.entrenar_y_predecir(filas[::-1], umbral_riego_pct=30.0, dias_futuro=7)
                if pred.get("disponible") and pred.get("predicciones_diarias"):
                    n_preds = predictivo.guardar_predicciones_en_db(cur, eid, pred["predicciones_diarias"])
                    print(f"ETL: {n_preds} días de predicciones guardados en tabla 'prediccion_diaria' para {eid}", flush=True)

                # Si hay alerta predictiva de déficit hídrico crítico
                if pred.get("disponible") and pred.get("alerta_predictiva"):
                    ap = pred["alerta_predictiva"]
                    notificar_websocket(
                        tipo="prediccion",
                        titulo=f"Alerta Predictiva Hídrica · {eid}",
                        mensaje=ap["mensaje"],
                        severidad=ap.get("severidad", "warning"),
                        datos={"planta_id": eid, "horas_hasta_riego": pred.get("horas_hasta_riego"), "humedad_actual": pred.get("humedad_actual")},
                    )
    except Exception as e:
        print("Aviso al calcular predicciones en ETL:", e, flush=True)

    print(
        f"ETL [{modo}] completado recursivamente: {stats['lotes']} lotes, {stats['lecturas']} lecturas "
        f"({stats['imputadas']} imputadas), {len(stats['alertas'])} alertas nuevas.",
        flush=True,
    )

    # Avisar al frontend que el ETL completó sincronización
    if stats["lecturas"] > 0:
        notificar_websocket(
            tipo="etl_sincronizado",
            titulo="Sincronización ETL",
            mensaje=f"Se procesaron {stats['lecturas']} nuevas lecturas en el DWH.",
            severidad="info",
            datos=stats,
        )

    return stats


def preparar(conn: psycopg.Connection) -> None:
    if os.path.exists(SCHEMA_FILE):
        with open(SCHEMA_FILE, encoding="utf-8") as f:
            conn.execute(f.read())
    # calentar ventanas de atipicos
    for eid, t, h in conn.execute(
            "SELECT entity_id, temperature, humidity FROM lectura_limpia "
            "WHERE ts > now() - interval '1 hour' ORDER BY ts"):
        if t is not None:
            ventanas[(eid, "temperature")].append(t)
        if h is not None:
            ventanas[(eid, "humidity")].append(h)
    # calentar los ultimos valores validos conocidos para interpolacion
    for eid, ts, t, h, lx, s in conn.execute("""
            SELECT DISTINCT ON (entity_id) entity_id, extract(epoch from ts)*1000,
                   temperature, humidity, luminosity, soil_moisture
            FROM lectura_limpia ORDER BY entity_id, ts DESC"""):
        for var, val in [("temperature", t), ("humidity", h), ("luminosity", lx), ("soil_moisture", s)]:
            if val is not None:
                last_valid[(eid, var)] = (int(ts), val)


def main() -> None:
    parser = argparse.ArgumentParser(description="Worker ETL AgroSense")
    parser.add_argument("--deploy", "--once", action="store_true", dest="deploy",
                        help="Ejecución directa única: drena todo el backlog recursivamente y termina de inmediato sin ciclo.")
    parser.add_argument("--daemon", action="store_true", dest="daemon",
                        help="Ejecuta en bucle continuo tradicional (opcional, para entornos sin crontab).")
    args = parser.parse_args()

    # Por defecto, el ETL ahora corre en modo ejecución única (invocado por CRONTAB o despliegue)
    # eliminando el bucle infinito tradicional en Python.
    es_demonio = args.daemon and not args.deploy

    conn = None
    try:
        conn = psycopg.connect(DSN, autocommit=True, options=f"-c timezone={ZONA}")
        preparar(conn)
        print("ETL conectado al DWH (Postgres)", flush=True)

        if not es_demonio:
            # Modo Crontab / Despliegue: ejecuta la corrida recursiva a fondo y termina limpiamente
            modo = "despliegue" if args.deploy else "crontab"
            print(f">>> Ejecución ETL [{modo}] (sin ciclo infinito)...", flush=True)
            stats = ejecutar_etl(conn, modo=modo)
            conn.close()
            print(f">>> ETL [{modo}] finalizado exitosamente. Total procesado: {stats['lecturas']} registros.", flush=True)
            sys.exit(0)

        # Modo demonio opcional (solo si se especifica explícitamente --daemon)
        print(f"ETL en modo demonio continuo (intervalo: {INTERVAL}s)...", flush=True)
        while True:
            try:
                ejecutar_etl(conn, modo="demonio")
            except Exception as e:
                print("ETL error en ciclo:", repr(e), flush=True)
                if conn is not None and not conn.closed and conn.broken:
                    conn.close()
                    conn = psycopg.connect(DSN, autocommit=True, options=f"-c timezone={ZONA}")
            time.sleep(INTERVAL)

    except Exception as e:
        print("Fallo crítico en ETL:", repr(e), flush=True)
        if conn is not None and not conn.closed:
            conn.close()
        sys.exit(0 if es_demonio else 1)


if __name__ == "__main__":
    main()
