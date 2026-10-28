"""Módulo de Notificaciones para AgroSense: WebSocket y Telegram.

Soporta:
1. Notificaciones en tiempo real vía WebSocket a la interfaz web.
2. Notificaciones automatizadas push a Telegram (vía Bot API oficial usando urllib estándar).
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from typing import Any

ETIQUETAS_TIPO = {
    "temperature_bajo": "Temperatura baja",
    "temperature_alto": "Temperatura alta",
    "temperature_atipico": "Temperatura atípica",
    "temperature_invalido": "Sensor de temperatura inválido",
    "temperature_imputado": "Temperatura interpolada",
    "humidity_bajo": "Humedad del aire baja",
    "humidity_alto": "Humedad del aire alta",
    "humidity_atipico": "Humedad del aire atípica",
    "humidity_invalido": "Sensor de humedad inválido",
    "humidity_imputado": "Humedad del aire interpolada",
    "luminosity_bajo": "Luminosidad baja",
    "luminosity_alto": "Luminosidad alta",
    "luminosity_invalido": "Sensor de luz inválido",
    "luminosity_imputado": "Luminosidad interpolada",
    "soil_moisture_bajo": "Humedad del suelo baja",
    "soil_moisture_alto": "Humedad del suelo alta",
    "soil_moisture_invalido": "Sensor de suelo inválido",
    "soil_moisture_imputado": "Humedad del suelo interpolada",
    "sin_datos": "Sensor sin transmisión de datos",
}


def _limpiar_md(texto: str) -> str:
    """Reemplaza guiones bajos sueltos para evitar errores HTTP 400 del parser Markdown de Telegram."""
    return str(texto).replace("_", " ")


def formatear_mensaje_alerta(tipo: str, titulo: str, mensaje: str, datos: dict[str, Any] | None = None) -> str:
    """Genera un mensaje de alerta enriquecido con formato Markdown seguro y emojis agronómicos para Telegram."""
    datos = datos or {}
    planta = _limpiar_md(datos.get("planta_id", "planta01"))

    if tipo == "prediccion":
        h_riego = datos.get("horas_hasta_riego")
        h_actual = datos.get("humedad_actual")
        tasa_hora = datos.get("tasa_cambio")
        tasa_dia = datos.get("tasa_cambio_diaria")

        encabezado = (
            "🚨 *AgroSense · Alerta Predictiva de Riego* 🚨"
            if (h_riego is not None and float(h_riego) <= 6.0)
            else "🌱 *AgroSense · Reporte Predictivo Hídrico Automático*"
        )
        lineas = [
            encabezado,
            f"🌿 *Cultivo:* `{planta}`",
        ]
        if h_actual is not None:
            lineas.append(f"💧 *Humedad de suelo actual:* *{h_actual}%*")
        if h_riego is not None:
            if float(h_riego) <= 0:
                lineas.append("🚨 *¡AGUA AGOTADA! El suelo está por debajo del umbral crítico (30%). Riego urgente.*")
            else:
                lineas.append(f"⏳ *Tiempo estimado hasta riego:* *~{h_riego} horas*")
        if tasa_dia is not None:
            lineas.append(f"📉 *Tasa de variación:* *{tasa_dia}%/día* ({tasa_hora}%/h)" if tasa_hora is not None else f"📉 *Tasa de variación:* *{tasa_dia}%/día*")
        elif tasa_hora is not None:
            lineas.append(f"📉 *Velocidad de secado:* *{tasa_hora}%/h*")
        lineas.append(f"📋 *Diagnóstico:* {_limpiar_md(mensaje)}")
        lineas.append("🌐 Panel en vivo: http://32.193.138.160")
        return "\n".join(lineas)

    # Alerta técnica o física del ETL
    raw_tipo = datos.get("tipo", "")
    etiqueta = ETIQUETAS_TIPO.get(raw_tipo, _limpiar_md(titulo))
    severidad_emoji = "🔴 *ERROR*" if datos.get("severidad") == "error" else "🟡 *ADVERTENCIA*"
    return (
        f"🌱 *AgroSense · Alerta Automática del Cultivo*\n"
        f"🌿 *Planta:* `{planta}`\n"
        f"{severidad_emoji}: *{etiqueta}*\n"
        f"📝 *Detalle:* {_limpiar_md(mensaje)}\n"
        f"🌐 Panel en vivo: http://32.193.138.160"
    )


def _post_telegram(url: str, payload_dict: dict[str, Any]) -> dict[str, Any]:
    payload = json.dumps(payload_dict).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        return {
            "enviado": bool(data.get("ok", False)),
            "status_code": resp.status,
            "respuesta": data,
        }


def enviar_telegram_automatico(texto: str, chat_id: str = "", bot_token: str = "") -> dict[str, Any]:
    """Envía un mensaje a Telegram con respaldo en texto plano si Markdown falla."""
    cid = chat_id or os.environ.get("TELEGRAM_CHAT_ID", "")
    tok = bot_token or os.environ.get("TELEGRAM_BOT_TOKEN", "")

    if not cid or not tok:
        return {
            "enviado": False,
            "motivo": "Credenciales de Telegram (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) no configuradas en .env",
        }

    url = f"https://api.telegram.org/bot{tok}/sendMessage"
    try:
        return _post_telegram(url, {
            "chat_id": str(cid),
            "text": texto,
            "parse_mode": "Markdown",
            "disable_web_page_preview": True,
        })
    except Exception:
        try:
            # Respaldo sin parse_mode para garantizar entrega aunque haya caracteres especiales
            return _post_telegram(url, {
                "chat_id": str(cid),
                "text": texto.replace("*", "").replace("`", ""),
                "disable_web_page_preview": True,
            })
        except Exception as e:
            return {
                "enviado": False,
                "error": str(e),
                "motivo": f"Error al comunicar con Telegram: {e}",
            }


def despachar_alerta_externa(texto: str) -> dict[str, Any]:
    """Envía la alerta por el canal automático de Telegram."""
    tok = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    cid = os.environ.get("TELEGRAM_CHAT_ID", "")
    res = {}
    if tok and cid:
        res["telegram"] = enviar_telegram_automatico(texto, cid, tok)
    return res
