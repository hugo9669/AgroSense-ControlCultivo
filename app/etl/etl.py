"""ETL: CrateDB (crudo) -> limpiar -> detectar atipicos -> analizar -> Postgres (DWH) + alertas a Orion.

Ciclo cada ETL_INTERVAL_SECONDS:
  1. Extrae de Crate las lecturas nuevas (posteriores a la ultima cargada en el DWH).
  2. Limpia: fuera de rango fisico -> NULL (error de sensor). Temperatura/humedad con salto brusco
     respecto a la mediana reciente -> NULL (valor atipico).
  3. Analiza: genera alertas warning/error (sin repetir la misma alerta en DEDUP_MIN minutos).
  4. Carga lecturas limpias, alertas y resumenes horario/diario.
  5. Publica la ultima alerta de cada planta en Orion (entidad PlantAlert): lazo de retorno.
"""
import os
import statistics
import time
from collections import defaultdict, deque

import psycopg
import requests

CRATE_URL = os.environ["CRATE_URL"]
TABLE = os.environ["CRATE_TABLE"]
DSN = os.environ["DWH_DSN"]
ORION = os.environ["ORION_URL"]
CRATE_AUTH = (os.environ.get("CRATE_USER", "iot"), os.environ.get("CRATE_PASSWORD", ""))
INTERVAL = int(os.environ.get("ETL_INTERVAL_SECONDS", "300"))
SIN_DATOS_MIN = int(os.environ.get("SIN_DATOS_MINUTOS", "15"))
ZONA = os.environ.get("ZONA_HORARIA", "America/Bogota")
SCHEMA_FILE = os.environ.get("SCHEMA_FILE", "/schema/init.sql")
FIWARE_HEADERS = {"fiware-service": "openiot", "fiware-servicepath": "/"}

# Rangos fisicos validos (limpiar) y umbrales recomendados (analizar). Ajustar al cultivo.
# Mantener alineado con app/frontend/src/lib/umbrales.js
VALID = {"temperature": (-10, 60), "humidity": (0, 100), "luminosity": (0, 120000), "soil_moisture": (0, 100)}
WARN = {"temperature": (10, 35), "humidity": (30, 90), "luminosity": (1000, 80000), "soil_moisture": (20, 80)}

# Atipicos (solo temperatura y humedad del aire): |v - mediana| > max(K * MAD, delta minimo)
OUTLIER_MIN_DELTA = {"temperature": 6.0, "humidity": 20.0}
OUTLIER_K = 5
VENTANA = 20
DEDUP_MIN = 30

NOMBRE = {"temperature": "temperatura", "humidity": "humedad del aire",
          "luminosity": "luminosidad", "soil_moisture": "humedad del suelo"}
UNIDAD = {"temperature": "°C", "humidity": "%", "luminosity": "lx", "soil_moisture": "%"}

ventanas = defaultdict(lambda: deque(maxlen=VENTANA))  # (entity_id, variable) -> valores recientes


# ---------------- Extraer ----------------
def extract(since_ms):
    q = (f"SELECT entity_id, time_index, temperature, humidity, luminosity, soilmoisture "
         f"FROM {TABLE} WHERE time_index > ? ORDER BY time_index LIMIT 5000")
    r = requests.post(CRATE_URL, json={"stmt": q, "args": [since_ms]}, auth=CRATE_AUTH, timeout=30)
    if r.status_code == 404 or "TableUnknownException" in r.text:
        return []  # la tabla aun no existe: QuantumLeap la crea con la primera lectura
    r.raise_for_status()
    return r.json()["rows"]


# ---------------- Limpiar ----------------
def es_atipico(eid, k, v):
    w = ventanas[(eid, k)]
    if len(w) < 5:
        return False
    med = statistics.median(w)
    mad = statistics.median(abs(x - med) for x in w)
    return abs(v - med) > max(OUTLIER_K * mad, OUTLIER_MIN_DELTA[k])


def clean(rows):
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
                # tambien entran los atipicos: si el cambio es real y se sostiene, la mediana lo alcanza
                ventanas[(eid, k)].append(v)
        out.append((eid, ts, vals, flags))
    return out


# ---------------- Analizar ----------------
def analyze(rows):
    alerts = []  # (entity_id, ts_ms, severidad, variable, tipo, mensaje)
    for eid, ts, vals, flags in rows:
        for k, v in vals.items():
            n, u = NOMBRE[k], UNIDAD[k]
            lo, hi = WARN[k]
            if k in flags:
                motivo, crudo = flags[k]
                if motivo == "invalido":
                    det = "ausente" if crudo is None else f"fuera de rango físico ({crudo})"
                    alerts.append((eid, ts, "error", k, f"{k}_invalido",
                                   f"Lectura de {n} inválida: {det}. Posible falla o desconexión del sensor"))
                else:
                    alerts.append((eid, ts, "warning", k, f"{k}_atipico",
                                   f"Valor atípico de {n} descartado: {crudo:.1f} {u} (cambio brusco)"))
            elif v < lo:
                alerts.append((eid, ts, "warning", k, f"{k}_bajo",
                               f"{n.capitalize()} baja: {v:.1f} {u} (mínimo recomendado {lo} {u})"))
            elif v > hi:
                alerts.append((eid, ts, "warning", k, f"{k}_alto",
                               f"{n.capitalize()} alta: {v:.1f} {u} (máximo recomendado {hi} {u})"))
    return alerts


# ---------------- Cargar ----------------
def insert_alert(cur, eid, ts_ms, sev, var, tipo, msg, dedup_min=DEDUP_MIN):
    """Inserta la alerta salvo que la misma (planta, tipo) ya exista en los ultimos dedup_min minutos."""
    cur.execute(
        "INSERT INTO alerta(entity_id, ts, severidad, variable, tipo, mensaje) "
        "SELECT %s, to_timestamp(%s/1000.0), %s, %s, %s, %s "
        "WHERE NOT EXISTS (SELECT 1 FROM alerta WHERE entity_id=%s AND tipo=%s "
        "  AND ts > to_timestamp(%s/1000.0) - make_interval(mins => %s::int)) "
        "ON CONFLICT DO NOTHING RETURNING id",
        (eid, ts_ms, sev, var, tipo, msg, eid, tipo, ts_ms, dedup_min))
    return cur.fetchone() is not None


def load(cur, rows, alerts, since_ms):
    cur.executemany(
        "INSERT INTO lectura_limpia(entity_id, ts, temperature, humidity, luminosity, soil_moisture) "
        "VALUES (%s, to_timestamp(%s/1000.0), %s, %s, %s, %s) ON CONFLICT DO NOTHING",
        [(e, ts, v["temperature"], v["humidity"], v["luminosity"], v["soil_moisture"]) for e, ts, v, _ in rows])

    nuevas = [a for a in alerts if insert_alert(cur, *a)]

    # Se recalculan completas las horas/dias tocados por este lote (desde la hora/dia de la ultima carga)
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


def check_sin_datos(cur):
    """Error si una planta lleva mas de SIN_DATOS_MIN sin enviar lecturas (una alerta por corte)."""
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


def notify_orion(alerts):
    """Lazo de retorno de la pizarra: la ultima alerta de cada planta vuelve a Orion como entidad."""
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


# ---------------- Bucle ----------------
def preparar(conn):
    with open(SCHEMA_FILE, encoding="utf-8") as f:
        conn.execute(f.read())
    # calentar las ventanas de atipicos con la ultima hora ya cargada
    for eid, t, h in conn.execute(
            "SELECT entity_id, temperature, humidity FROM lectura_limpia "
            "WHERE ts > now() - interval '1 hour' ORDER BY ts"):
        if t is not None:
            ventanas[(eid, "temperature")].append(t)
        if h is not None:
            ventanas[(eid, "humidity")].append(h)


def ciclo(conn):
    cur = conn.cursor()
    cur.execute("SELECT coalesce(max(extract(epoch FROM ts))*1000, 0)::bigint FROM lectura_limpia")
    since = cur.fetchone()[0]
    rows = clean(extract(since))
    nuevas = load(cur, rows, analyze(rows), since) if rows else []
    nuevas += check_sin_datos(cur)
    notify_orion(nuevas)
    print(f"ETL ok: {len(rows)} lecturas, {len(nuevas)} alertas nuevas", flush=True)


def main():
    conn = None
    while True:
        try:
            if conn is None or conn.closed:
                conn = psycopg.connect(DSN, autocommit=True, options=f"-c timezone={ZONA}")
                preparar(conn)
                print("ETL conectado al DWH", flush=True)
            ciclo(conn)
        except Exception as e:  # el ciclo nunca debe morir
            print("ETL error:", repr(e), flush=True)
            if conn is not None and not conn.closed and conn.broken:
                conn.close()
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
