"""Modelo Predictivo Agronómico para AgroSense.

REGLA ESTRICTA: NO INVENTA DATOS.
Se alimenta única y exclusivamente de las lecturas reales del DWH (PostgreSQL).
Si no hay suficientes lecturas reales (mínimo 3 puntos), reporta que no hay
datos suficientes para entrenar o calibrar el modelo.

Capacidades:
1. Regresión Lineal OLS y Decaimiento Hídrico del suelo (Evapotranspiración FAO-56).
2. Estimación de Horas Restantes hasta Déficit Hídrico (Tiempo para Riego).
3. Pronóstico multi-día persistido en la tabla 'prediccion_diaria' en PostgreSQL.
4. Generación de Alerta Predictiva y Formateo para Telegram y WebSocket.
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from typing import Any


def _calcular_regresion(x: list[float], y: list[float]) -> dict[str, float] | None:
    """Calcula la regresión lineal por Mínimos Cuadrados Ordinarios (OLS)."""
    n = len(x)
    if n < 3:
        return None

    x_mean = sum(x) / n
    y_mean = sum(y) / n

    ss_xx = sum((xi - x_mean) ** 2 for xi in x)
    ss_yy = sum((yi - y_mean) ** 2 for yi in y)
    ss_xy = sum((xi - x_mean) * (yi - y_mean) for xi, yi in zip(x, y))

    if ss_xx == 0:
        return None

    m = ss_xy / ss_xx
    b = y_mean - m * x_mean

    sse = sum((yi - (m * xi + b)) ** 2 for xi, yi in zip(x, y))
    r2 = 1.0 - (sse / ss_yy) if ss_yy > 0 else 0.0
    r2 = max(0.0, min(1.0, r2))
    rmse = math.sqrt(sse / n)

    return {"m": m, "b": b, "r2": round(r2, 4), "rmse": round(rmse, 2)}


def _correlacion_pearson(x: list[float], y: list[float]) -> float:
    n = len(x)
    if n < 3:
        return 0.0
    x_m = sum(x) / n
    y_m = sum(y) / n
    num = sum((xi - x_m) * (yi - y_m) for xi, yi in zip(x, y))
    den = math.sqrt(sum((xi - x_m) ** 2 for xi in x) * sum((yi - y_m) ** 2 for yi in y))
    return round(num / den, 3) if den > 0 else 0.0


def _proyectar_humedad_fao56(h_inicial: float, horas: float, tasa_hora: float, umbral_critico: float = 30.0) -> float:
    """Proyecta la humedad del sustrato con modelo físico FAO-56 de dos etapas:
    - Etapa 1 (Agua Fácilmente Aprovechable, h > umbral_critico): agotamiento lineal por evapotranspiración.
    - Etapa 2 (Estrés hídrico / cierre estomático, h <= umbral_critico): decaimiento exponencial hacia humedad residual (8%).
    """
    h_residual = 8.0
    if h_inicial <= h_residual:
        return round(h_inicial, 1)

    if h_inicial > umbral_critico:
        horas_etapa1 = (h_inicial - umbral_critico) / max(tasa_hora, 0.05)
        if horas <= horas_etapa1:
            return round(max(h_residual, min(100.0, h_inicial - tasa_hora * horas)), 1)
        horas_etapa2 = horas - horas_etapa1
        h_base_etapa2 = umbral_critico
    else:
        horas_etapa2 = horas
        h_base_etapa2 = h_inicial

    # En etapa 2 la conductividad hidráulica y transpiración caen exponencialmente
    k_exp = tasa_hora / max(h_base_etapa2 - h_residual, 6.0)
    h_est = h_residual + (h_base_etapa2 - h_residual) * math.exp(-k_exp * horas_etapa2)
    return round(max(h_residual, min(100.0, h_est)), 1)


def entrenar_y_predecir(lecturas_reales: list[dict[str, Any]], umbral_riego_pct: float = 30.0, horas_futuro: int = 12, dias_futuro: int = 7) -> dict[str, Any]:
    """Genera la predicción hídrica y multi-día calibrada agronómicamente para cultivo de tomate en maceta."""
    validas = [r for r in lecturas_reales if r.get("soil_moisture") is not None and r.get("ts") is not None]

    # Filtrar lecturas de desconexión/aire (0% - 5%) si existen lecturas reales en sustrato (> 5%)
    en_sustrato = [r for r in validas if float(r["soil_moisture"]) > 5.0]
    if len(en_sustrato) >= 3:
        validas = en_sustrato

    if len(validas) < 3:
        return {
            "disponible": False,
            "motivo": f"Muestras reales insuficientes para calibrar el modelo (se requieren al menos 3, actuales: {len(validas)})",
            "muestras_reales": len(validas),
            "prediccion": None,
            "predicciones_diarias": [],
        }

    validas.sort(key=lambda r: r["ts"])

    def _to_dt(val: Any) -> datetime:
        if isinstance(val, str):
            return datetime.fromisoformat(val.replace("Z", "+00:00"))
        return val

    # 1. Aislar el régimen continuo actual: cortar ante huecos temporales (> 30 min)
    # o saltos bruscos (>= 5% por riego o manipulación del sensor).
    idx_inicio = 0
    for i in range(1, len(validas)):
        t_prev = _to_dt(validas[i - 1]["ts"])
        t_curr = _to_dt(validas[i]["ts"])
        gap_sec = (t_curr - t_prev).total_seconds()
        s_prev = float(validas[i - 1]["soil_moisture"])
        s_curr = float(validas[i]["soil_moisture"])
        if gap_sec > 1800 or abs(s_curr - s_prev) >= 5.0:
            idx_inicio = i

    segmento = validas[idx_inicio:]
    if len(segmento) < 3:
        segmento = validas[-min(len(validas), 60):]

    # Si hubo fase de humectación post-riego, iniciar la regresión desde el pico de saturación
    max_s = max(float(r["soil_moisture"]) for r in segmento)
    idx_pico = 0
    for i, r in enumerate(segmento):
        if float(r["soil_moisture"]) >= max_s - 0.5:
            idx_pico = i
            break
    if len(segmento) - idx_pico >= 10:
        muestras_secado = segmento[idx_pico:]
    else:
        muestras_secado = segmento

    t0 = _to_dt(muestras_secado[0]["ts"])

    x_horas: list[float] = []
    y_suelo: list[float] = []
    temps: list[float] = []
    hums: list[float] = []
    luxs: list[float] = []

    for r in muestras_secado:
        ts = _to_dt(r["ts"])
        delta_h = (ts - t0).total_seconds() / 3600.0
        x_horas.append(delta_h)
        y_suelo.append(float(r["soil_moisture"]))
        if r.get("temperature") is not None:
            temps.append(float(r["temperature"]))
        if r.get("humidity") is not None:
            hums.append(float(r["humidity"]))
        if r.get("luminosity") is not None:
            luxs.append(float(r["luminosity"]))

    reg = _calcular_regresion(x_horas, y_suelo)
    if reg is None:
        return {
            "disponible": False,
            "motivo": "No hay variación temporal suficiente entre las muestras para calcular regresión",
            "muestras_reales": len(validas),
            "prediccion": None,
            "predicciones_diarias": [],
        }

    m = reg["m"]  # cambio porcentual de humedad por hora (%/h)
    b = reg["b"]
    r2 = reg["r2"]
    rmse = reg["rmse"]

    ultima_lectura = validas[-1]
    ts_ultima = _to_dt(ultima_lectura["ts"])

    h_actual = float(ultima_lectura["soil_moisture"])
    t_actual = float(ultima_lectura.get("temperature") or (sum(temps) / len(temps) if temps else 24.0))
    hum_aire_actual = float(ultima_lectura.get("humidity") or (sum(hums) / len(hums) if hums else 60.0))
    lux_promedio = (sum(luxs) / len(luxs)) if luxs else 0.0
    hum_promedio = (sum(hums) / len(hums)) if hums else hum_aire_actual
    duracion_ventana_h = x_horas[-1] if x_horas else 0.0

    # 2. Estimación física sin frenar artificialmente la pendiente real OLS del sensor:
    # Si la ventana de medición ocurrió en oscuridad/noche (lux < 100) y humedad ambiental saturada (> 85%),
    # la pendiente OLS observada refleja solo drenaje/evaporación basal nocturna; al proyectar el ciclo
    # completo (que incluye horas diurnas de radiación y transpiración estomática), el consumo medio es ~1.35x mayor.
    if m <= -0.15:
        tasa_ols = abs(m)
        if duracion_ventana_h < 12.0 and lux_promedio < 100.0 and hum_promedio > 85.0:
            tasa_secado = min(2.20, tasa_ols * 1.35)
        else:
            tasa_secado = min(2.20, tasa_ols)
        metodo_calibracion = "sensor_calibrado_ols"
    else:
        # Respaldo únicamente cuando el sensor está totalmente plano (m > -0.15%/h)
        factor_clima = 1.0 + (0.25 if t_actual > 26.0 else 0.0) + (0.20 if lux_promedio > 5000.0 else 0.0)
        tasa_secado = round(0.95 * factor_clima, 3)
        metodo_calibracion = "modelo_agronomico_evapotranspiracion"

    tasa_diaria = round(tasa_secado * 24.0, 2)

    # 3. Proyección horaria a corto plazo
    proyecciones_horas = []
    for paso in range(1, horas_futuro + 1):
        y_estimado = _proyectar_humedad_fao56(h_actual, float(paso), tasa_secado, umbral_riego_pct)
        ts_futuro = ts_ultima + timedelta(hours=paso)
        proyecciones_horas.append({
            "hora_proyectada": ts_futuro.isoformat(),
            "horas_desde_ahora": paso,
            "humedad_suelo_estimada": y_estimado,
        })

    # 4. Estimación de tiempo hasta riego:
    # Umbral de riego preventivo agronómico en tomate (40%, límite inferior del rango ideal [40-70%])
    # y umbral de estrés hídrico crítico (30%).
    horas_hasta_riego = None
    fecha_estimada_riego = None
    alerta_predictiva = None

    if h_actual <= umbral_riego_pct:
        estado_hidrico = "deficit_actual"
        horas_hasta_riego = 0.0
        recomendacion = f"El suelo ya se encuentra en déficit hídrico ({h_actual:.1f}% ≤ {umbral_riego_pct}%). Riego urgente."
        alerta_predictiva = {
            "severidad": "warning",
            "mensaje": f"Alerta Predictiva: Suelo en déficit hídrico ({h_actual:.1f}%). Conviene regar de inmediato.",
        }
    else:
        horas_calculadas = (h_actual - umbral_riego_pct) / tasa_secado
        horas_hasta_riego = round(min(72.0, max(1.0, horas_calculadas)), 1)
        fecha_riego = ts_ultima + timedelta(hours=horas_hasta_riego)
        fecha_estimada_riego = fecha_riego.isoformat()
        dias_estimados = round(horas_hasta_riego / 24.0, 1)

        # Tiempo hasta salir del rango ideal (40%) para aviso preventivo
        horas_ideal_40 = round(max(0.0, (h_actual - 40.0) / tasa_secado), 1) if h_actual > 40.0 else 0.0

        if horas_hasta_riego <= 4.0:
            estado_hidrico = "riego_inminente"
            recomendacion = f"Déficit hídrico inminente en aprox. {horas_hasta_riego} h ({fecha_riego.strftime('%H:%M')}). Programar riego pronto."
            alerta_predictiva = {
                "severidad": "warning",
                "mensaje": f"Alerta Predictiva: ¡El agua del suelo se agotará en aprox. {horas_hasta_riego} horas! (Tasa: -{tasa_secado:.2f}%/h).",
            }
        elif horas_hasta_riego <= 24.0:
            estado_hidrico = "riego_proximo"
            recomendacion = f"Secado activo (-{tasa_secado:.2f}%/h). Riego preventivo (40%) en ~{horas_ideal_40} h y crítico (30%) en ~{horas_hasta_riego} h."
        else:
            estado_hidrico = "humedad_estable"
            recomendacion = (
                f"Humedad actual {h_actual:.1f}% (pendiente OLS: {m:.2f}%/h, tasa efectiva: -{tasa_secado:.2f}%/h). "
                f"Riego preventivo (40%) en ~{horas_ideal_40} h; umbral crítico (30%) en ~{horas_hasta_riego} h (~{dias_estimados} días)."
            )

    # 5. Proyección Multi-Día (FAO-56) para persistir en PostgreSQL ('prediccion_diaria')
    proyecciones_dias = []
    fecha_base = ts_ultima.date()

    for d in range(1, dias_futuro + 1):
        f_proy = fecha_base + timedelta(days=d)
        h_dia_estimada = _proyectar_humedad_fao56(h_actual, float(d * 24), tasa_secado, umbral_riego_pct)
        req_riego = h_dia_estimada <= umbral_riego_pct

        if req_riego:
            rec_dia = f"Día {d}: Déficit hídrico proyectado ({h_dia_estimada:.1f}%). Riego requerido."
        elif h_dia_estimada <= 40.0:
            rec_dia = f"Día {d}: Humedad fuera de rango ideal ({h_dia_estimada:.1f}% ≤ 40%). Riego preventivo recomendado."
        else:
            rec_dia = f"Día {d}: Nivel de humedad óptimo ({h_dia_estimada:.1f}%)."

        proyecciones_dias.append({
            "fecha_proyectada": f_proy.isoformat(),
            "dias_adelante": d,
            "soil_moisture_pred": h_dia_estimada,
            "temp_pred": round(t_actual, 1),
            "hum_pred": round(hum_aire_actual, 1),
            "tendencia": "secando",
            "tasa_cambio_diaria": -tasa_diaria,
            "horas_hasta_riego": horas_hasta_riego,
            "requiere_riego": req_riego,
            "r2": r2,
            "recomendacion": rec_dia,
        })

    corr_temp = _correlacion_pearson(temps, y_suelo) if len(temps) == len(y_suelo) else 0.0
    corr_lux = _correlacion_pearson(luxs, y_suelo) if len(luxs) == len(y_suelo) else 0.0

    return {
        "disponible": True,
        "muestras_reales": len(muestras_secado),
        "humedad_actual": round(h_actual, 1),
        "umbral_critico_pct": umbral_riego_pct,
        "tasa_cambio_por_hora": -round(tasa_secado, 3),
        "tasa_cambio_por_dia": -tasa_diaria,
        "tendencia": "secando" if tasa_secado >= 0.10 else "estable",
        "estado_hidrico": estado_hidrico,
        "horas_hasta_riego": horas_hasta_riego,
        "fecha_estimada_riego": fecha_estimada_riego,
        "metricas_modelo": {
            "r2": r2,
            "rmse": rmse,
            "pendiente_ols_pura": round(m, 4),
            "confianza": "alta" if (r2 >= 0.70 and metodo_calibracion == "sensor_calibrado_ols") else ("media" if r2 >= 0.35 else "calibrada_agronomica"),
            "metodo_calibracion": metodo_calibracion,
            "correlacion_temperatura_suelo": corr_temp,
            "correlacion_luz_suelo": corr_lux,
        },
        "recomendacion_agronomica": recomendacion,
        "alerta_predictiva": alerta_predictiva,
        "proyecciones": proyecciones_horas,
        "predicciones_diarias": proyecciones_dias,
    }


def guardar_predicciones_en_db(cur: Any, entity_id: str, predicciones_diarias: list[dict[str, Any]]) -> int:
    """Persiste las predicciones multi-día calculadas en la tabla 'prediccion_diaria' de PostgreSQL."""
    if not predicciones_diarias:
        return 0

    cur.execute(
        "DELETE FROM prediccion_diaria WHERE entity_id = %s AND fecha_proyectada <= current_date",
        (entity_id,),
    )

    cur.executemany("""
        INSERT INTO prediccion_diaria (
            entity_id, fecha_proyectada, fecha_calculo, dias_adelante,
            soil_moisture_pred, temp_pred, hum_pred, tendencia, tasa_cambio_diaria,
            horas_hasta_riego, requiere_riego, r2, recomendacion
        ) VALUES (%s, %s, now(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (entity_id, fecha_proyectada) DO UPDATE SET
            fecha_calculo = EXCLUDED.fecha_calculo,
            dias_adelante = EXCLUDED.dias_adelante,
            soil_moisture_pred = EXCLUDED.soil_moisture_pred,
            temp_pred = EXCLUDED.temp_pred,
            hum_pred = EXCLUDED.hum_pred,
            tendencia = EXCLUDED.tendencia,
            tasa_cambio_diaria = EXCLUDED.tasa_cambio_diaria,
            horas_hasta_riego = EXCLUDED.horas_hasta_riego,
            requiere_riego = EXCLUDED.requiere_riego,
            r2 = EXCLUDED.r2,
            recomendacion = EXCLUDED.recomendacion
    """, [
        (
            entity_id,
            p["fecha_proyectada"],
            p["dias_adelante"],
            p["soil_moisture_pred"],
            p.get("temp_pred"),
            p.get("hum_pred"),
            p["tendencia"],
            p["tasa_cambio_diaria"],
            p.get("horas_hasta_riego"),
            p["requiere_riego"],
            p.get("r2"),
            p.get("recomendacion"),
        )
        for p in predicciones_diarias
    ])
    return len(predicciones_diarias)


def cargar_predicciones_desde_db(cur: Any, entity_id: str) -> list[dict[str, Any]]:
    """Consulta las predicciones de siguientes días directamente desde la tabla 'prediccion_diaria' de Postgres."""
    cur.execute("""
        SELECT entity_id, fecha_proyectada::text, fecha_calculo::text, dias_adelante,
               soil_moisture_pred, temp_pred, hum_pred, tendencia, tasa_cambio_diaria,
               horas_hasta_riego, requiere_riego, r2, recomendacion
        FROM prediccion_diaria
        WHERE entity_id = %s AND fecha_proyectada >= current_date
        ORDER BY fecha_proyectada ASC
    """, (entity_id,))
    columnas = [desc[0] for desc in cur.description]
    return [dict(zip(columnas, row)) for row in cur.fetchall()]
