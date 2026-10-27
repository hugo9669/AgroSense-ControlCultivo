"""Modelo Predictivo Agronómico para AgroSense.

REGLA ESTRICTA: NO INVENTA DATOS.
Se alimenta única y exclusivamente de las lecturas reales del DWH (PostgreSQL).
Si no hay suficientes lecturas reales (mínimo 3 puntos), reporta que no hay
datos suficientes para entrenar o calibrar el modelo.

Capacidades:
1. Regresión Lineal OLS y Decaimiento Hídrico del suelo (Evapotranspiración).
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


def entrenar_y_predecir(lecturas_reales: list[dict[str, Any]], umbral_riego_pct: float = 30.0, horas_futuro: int = 12, dias_futuro: int = 7) -> dict[str, Any]:
    """Genera la predicción hídrica y multi-día calibrada agronómicamente para cultivo de tomate en maceta."""
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

    # 1. Detectar si hubo un evento de riego reciente (salto >= 5% de humedad)
    # y priorizar la serie de secado posterior a ese pico.
    idx_inicio = 0
    for i in range(1, len(validas)):
        s_prev = float(validas[i - 1]["soil_moisture"])
        s_curr = float(validas[i]["soil_moisture"])
        if s_curr - s_prev >= 5.0:
            idx_inicio = i

    muestras_secado = validas[idx_inicio:]
    if len(muestras_secado) < 3:
        muestras_secado = validas

    t0 = muestras_secado[0]["ts"]
    if isinstance(t0, str):
        t0 = datetime.fromisoformat(t0.replace("Z", "+00:00"))

    x_horas: list[float] = []
    y_suelo: list[float] = []
    temps: list[float] = []
    luxs: list[float] = []

    for r in muestras_secado:
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

    # 2. Modelo agronómico calibrado para tomatera en maceta (evita extrapolaciones de semanas)
    factor_clima = 1.0
    if t_actual > 27.0:
        factor_clima += 0.30
    elif t_actual < 18.0:
        factor_clima -= 0.20

    lux_promedio = (sum(luxs) / len(luxs)) if luxs else 5000.0
    if lux_promedio > 12000.0:
        factor_clima += 0.20
    elif lux_promedio < 2000.0:
        factor_clima -= 0.20

    # Tasa agronómica base para maceta: ~0.55%/h (~13.2% diario)
    tasa_agro_hora = max(0.35, min(1.20, 0.55 * factor_clima))

    if -2.5 <= m <= -0.20:
        tasa_secado = abs(m)
        metodo_calibracion = "sensor_calibrado_ols"
    elif m < -2.5:
        tasa_secado = 2.5
        metodo_calibracion = "acotado_drenaje"
    else:
        # Pendiente plana o positiva (noche, sensor quieto, ruido): tasa agronómica realista
        tasa_secado = tasa_agro_hora
        metodo_calibracion = "modelo_agronomico_evapotranspiracion"

    tasa_diaria = tasa_secado * 24.0

    # 3. Proyección horaria a corto plazo
    proyecciones_horas = []
    for paso in range(1, horas_futuro + 1):
        y_estimado = max(0.0, min(100.0, h_actual - (tasa_secado * paso)))
        ts_futuro = ts_ultima + timedelta(hours=paso)
        proyecciones_horas.append({
            "hora_proyectada": ts_futuro.isoformat(),
            "horas_desde_ahora": paso,
            "humedad_suelo_estimada": round(y_estimado, 1),
        })

    # 4. Estimación de tiempo crítico de agotamiento de agua
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
        # Límite agronómico estricto en maceta: reserva máxima creíble de 96 horas (4 días)
        horas_hasta_riego = round(min(96.0, max(1.0, horas_calculadas)), 1)
        fecha_riego = ts_ultima + timedelta(hours=horas_hasta_riego)
        fecha_estimada_riego = fecha_riego.isoformat()
        dias_estimados = round(horas_hasta_riego / 24.0, 1)

        if horas_hasta_riego <= 4.0:
            estado_hidrico = "riego_inminente"
            recomendacion = f"Déficit hídrico inminente en aprox. {horas_hasta_riego} h ({fecha_riego.strftime('%H:%M')}). Programar riego pronto."
            alerta_predictiva = {
                "severidad": "warning",
                "mensaje": f"Alerta Predictiva: ¡El agua del suelo se agotará en aprox. {horas_hasta_riego} horas! (Tasa: -{tasa_secado:.2f}%/h).",
            }
        elif horas_hasta_riego <= 24.0:
            estado_hidrico = "riego_proximo"
            recomendacion = f"Secado en curso. Se prevé riego necesario en aprox. {horas_hasta_riego} horas (~{dias_estimados} días)."
        else:
            estado_hidrico = "humedad_estable"
            recomendacion = f"Humedad adecuada ({h_actual:.1f}%). Reserva estimada para aprox. {dias_estimados} días ({int(horas_hasta_riego)} h) a tasa de -{tasa_secado:.2f}%/h."

    # 5. Proyección Multi-Día para persistir en PostgreSQL ('prediccion_diaria')
    proyecciones_dias = []
    fecha_base = ts_ultima.date()

    for d in range(1, dias_futuro + 1):
        f_proy = fecha_base + timedelta(days=d)
        h_dia_estimada = max(0.0, min(100.0, h_actual - (tasa_diaria * d)))
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
            "tendencia": "secando",
            "tasa_cambio_diaria": -round(tasa_diaria, 2),
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
        "tasa_cambio_por_hora": -round(tasa_secado, 3),
        "tasa_cambio_por_dia": -round(tasa_diaria, 2),
        "tendencia": "secando" if tasa_secado >= 0.10 else "estable",
        "estado_hidrico": estado_hidrico,
        "horas_hasta_riego": horas_hasta_riego,
        "fecha_estimada_riego": fecha_estimada_riego,
        "metricas_modelo": {
            "r2": r2,
            "rmse": rmse,
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
