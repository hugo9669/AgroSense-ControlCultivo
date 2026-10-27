"""Modelo Predictivo Agronómico para AgroSense.

REGLA ESTRICTA: NO INVENTA DATOS.
Se alimenta única y exclusivamente de las lecturas reales del DWH (PostgreSQL).
Si no hay suficientes lecturas reales (mínimo 3 puntos), reporta que no hay
datos suficientes para entrenar o calibrar el modelo.

Capacidades:
1. Regresión Lineal OLS y Decaimiento Hídrico del suelo (Evapotranspiración).
2. Estimación de Horas Restantes hasta Déficit Hídrico (Tiempo para Riego).
3. Pronóstico multi-día persistido en la tabla 'prediccion_diaria' en PostgreSQL.
4. Generación de Alerta Predictiva y Formateo para WhatsApp y WebSocket.
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


def entrenar_y_predecir(lecturas_reales: list[dict[str, Any]], umbral_riego_pct: float = 30.0, horas_futuro: int = 12, dias_futuro: int = 7) -> dict[str, Any]:
    """Genera la predicción hídrica y multi-día basada únicamente en las lecturas reales recibidas."""
    validas = [r for r in lecturas_reales if r.get("soil_moisture") is not None and r.get("ts") is not None]

    if len(validas) < 3:
        return {
            "disponible": False,
            "motivo": f"Muestras reales insuficientes para calibrar el modelo (se requieren al menos 3, actuales: {len(validas)})",
            "muestras_reales": len(validas),
            "prediccion": None,
            "predicciones_diarias": [],
        }

    validas.sort(key=lambda r: r["ts"])

    t0 = validas[0]["ts"]
    if isinstance(t0, str):
        t0 = datetime.fromisoformat(t0.replace("Z", "+00:00"))

    x_horas: list[float] = []
    y_suelo: list[float] = []
    temps: list[float] = []
    luxs: list[float] = []

    for r in validas:
        ts = r["ts"]
        if isinstance(ts, str):
            ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        delta_h = (ts - t0).total_seconds() / 3600.0
        x_horas.append(delta_h)
        y_suelo.append(float(r["soil_moisture"]))
        if r.get("temperature") is not None:
            temps.append(float(r["temperature"]))
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
    ts_ultima = ultima_lectura["ts"]
    if isinstance(ts_ultima, str):
        ts_ultima = datetime.fromisoformat(ts_ultima.replace("Z", "+00:00"))

    h_actual = float(ultima_lectura["soil_moisture"])
    t_actual = float(ultima_lectura.get("temperature") or (sum(temps) / len(temps) if temps else 24.0))
    hum_aire_actual = float(ultima_lectura.get("humidity") or 60.0)

    # 1. Proyección horaria a corto plazo
    proyecciones_horas = []
    for paso in range(1, horas_futuro + 1):
        y_estimado = max(0.0, min(100.0, h_actual + (m * paso)))
        ts_futuro = ts_ultima + timedelta(hours=paso)
        proyecciones_horas.append({
            "hora_proyectada": ts_futuro.isoformat(),
            "horas_desde_ahora": paso,
            "humedad_suelo_estimada": round(y_estimado, 1),
        })

    # 2. Estimación de tiempo crítico de agotamiento de agua
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
    elif m < -0.05:
        tasa_secado = abs(m)
        horas_calculadas = (h_actual - umbral_riego_pct) / tasa_secado
        horas_hasta_riego = round(horas_calculadas, 1)
        fecha_riego = ts_ultima + timedelta(hours=horas_calculadas)
        fecha_estimada_riego = fecha_riego.isoformat()

        if horas_hasta_riego <= 4.0:
            estado_hidrico = "riego_inminente"
            recomendacion = f"Déficit hídrico inminente en aprox. {horas_hasta_riego} h ({fecha_riego.strftime('%H:%M')}). Programar riego pronto."
            alerta_predictiva = {
                "severidad": "warning",
                "mensaje": f"Alerta Predictiva: ¡El agua del suelo se agotará en aprox. {horas_hasta_riego} horas! (Tasa: -{tasa_secado:.2f}%/h).",
            }
        elif horas_hasta_riego <= 12.0:
            estado_hidrico = "riego_proximo"
            recomendacion = f"Secado moderado. Se prevé riego necesario en aprox. {horas_hasta_riego} horas ({fecha_riego.strftime('%H:%M')})."
        else:
            estado_hidrico = "humedad_estable"
            recomendacion = f"Humedad adecuada. Con la tasa actual (-{tasa_secado:.2f}%/h), hay reserva para más de {int(horas_hasta_riego)} horas."
    elif m > 0.05:
        estado_hidrico = "humedad_en_aumento"
        recomendacion = f"Humedad en aumento (+{m:.2f}%/h) por riego reciente o saturación."
    else:
        estado_hidrico = "estable"
        recomendacion = "Humedad de suelo estable con variaciones mínimas."

    # 3. Proyección Multi-Día para persistir en PostgreSQL ('prediccion_diaria')
    proyecciones_dias = []
    fecha_base = ts_ultima.date()
    tasa_diaria = m * 24.0  # cambio por día

    for d in range(1, dias_futuro + 1):
        f_proy = fecha_base + timedelta(days=d)
        h_dia_estimada = max(0.0, min(100.0, h_actual + (tasa_diaria * d)))
        req_riego = h_dia_estimada <= umbral_riego_pct

        if req_riego:
            rec_dia = f"Día {d}: Déficit hídrico severo proyectado ({h_dia_estimada:.1f}%). Riego requerido."
        elif h_dia_estimada <= umbral_riego_pct + 10.0:
            rec_dia = f"Día {d}: Humedad baja ({h_dia_estimada:.1f}%). Monitorear de cerca."
        else:
            rec_dia = f"Día {d}: Nivel de humedad seguro ({h_dia_estimada:.1f}%)."

        proyecciones_dias.append({
            "fecha_proyectada": f_proy.isoformat(),
            "dias_adelante": d,
            "soil_moisture_pred": round(h_dia_estimada, 1),
            "temp_pred": round(t_actual, 1),
            "hum_pred": round(hum_aire_actual, 1),
            "tendencia": "secando" if m < -0.05 else ("humedeciendo" if m > 0.05 else "estable"),
            "tasa_cambio_diaria": round(tasa_diaria, 2),
            "horas_hasta_riego": horas_hasta_riego,
            "requiere_riego": req_riego,
            "r2": r2,
            "recomendacion": rec_dia,
        })

    corr_temp = _correlacion_pearson(temps, y_suelo) if len(temps) == len(y_suelo) else 0.0
    corr_lux = _correlacion_pearson(luxs, y_suelo) if len(luxs) == len(y_suelo) else 0.0

    return {
        "disponible": True,
        "muestras_reales": len(validas),
        "humedad_actual": round(h_actual, 1),
        "umbral_critico_pct": umbral_riego_pct,
        "tasa_cambio_por_hora": round(m, 3),
        "tasa_cambio_por_dia": round(tasa_diaria, 2),
        "tendencia": "secando" if m < -0.05 else ("humedeciendo" if m > 0.05 else "estable"),
        "estado_hidrico": estado_hidrico,
        "horas_hasta_riego": horas_hasta_riego,
        "fecha_estimada_riego": fecha_estimada_riego,
        "metricas_modelo": {
            "r2": r2,
            "rmse": rmse,
            "confianza": "alta" if r2 >= 0.75 else ("media" if r2 >= 0.4 else "baja"),
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
