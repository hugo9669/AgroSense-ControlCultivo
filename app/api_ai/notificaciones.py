"""Módulo de Notificaciones para AgroSense: WebSocket y Telegram.

Soporta:
1. Notificaciones en tiempo real vía WebSocket a la interfaz web.
2. Notificaciones automatizadas push a Telegram (vía Bot API oficial).
"""
from __future__ import annotations

import os
from typing import Any

try:
    import requests
except ImportError:
    requests = None

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")


def formatear_mensaje_alerta(tipo: str, titulo: str, mensaje: str, datos: dict[str, Any] | None = None) -> str:
    """Genera un mensaje de alerta enriquecido con formato Markdown y emojis agronómicos para Telegram."""
    datos = datos or {}
    planta = datos.get("planta_id", "planta01")

    if tipo == "prediccion":
        h_riego = datos.get("horas_hasta_riego")
        h_actual = datos.get("humedad_actual")
        tasa = datos.get("tasa_cambio")

        lineas = [
            "🚨 *AgroSense · Alerta Predictiva de Riego* 🚨",
            f"🌿 *Cultivo:* `{planta}`",
            f"💧 *Diagnóstico:* {mensaje}",
        ]
        if h_actual is not None:
            lineas.append(f"📊 *Humedad de suelo actual:* {h_actual}%")
        if tasa is not None:
            lineas.append(f"📉 *Velocidad de secado:* {tasa}%/h")
        if h_riego is not None:
            lineas.append(f"⏳ *Tiempo estimado para agotamiento:* ~{h_riego} horas")
        lineas.append("⚠️ *Acción:* Se aconseja preparar el sistema de riego.")
        return "\n".join(lineas)

    # Alerta técnica o física
    severidad_emoji = "🔴 *ERROR*" if datos.get("severidad") == "error" else "🟡 *ADVERTENCIA*"
    return (
        f"🌱 *AgroSense · Notificación del Cultivo*\n"
        f"🌿 *Planta:* `{planta}`\n"
        f"{severidad_emoji}: {titulo}\n"
        f"📝 *Detalle:* {mensaje}\n"
        f"🌐 Revisa el panel de control en tu navegador."
    )


def enviar_telegram_automatico(texto: str, chat_id: str = "", bot_token: str = "") -> dict[str, Any]:
    """Envía un mensaje a Telegram a través de la API oficial de bots de Telegram."""
    cid = chat_id or TELEGRAM_CHAT_ID
    tok = bot_token or TELEGRAM_BOT_TOKEN

    if not cid or not tok or requests is None:
        return {
            "enviado": False,
            "motivo": "Credenciales de Telegram (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) no configuradas en .env",
        }

    try:
        url = f"https://api.telegram.org/bot{tok}/sendMessage"
        payload = {
            "chat_id": cid,
            "text": texto,
            "parse_mode": "Markdown",
            "disable_web_page_preview": True,
        }
        r = requests.post(url, json=payload, timeout=10)
        res_json = r.json() if r.status_code == 200 else {}
        exito = r.status_code == 200 and res_json.get("ok", False)
        return {
            "enviado": exito,
            "status_code": r.status_code,
            "respuesta": res_json,
        }
    except Exception as e:
        return {
            "enviado": False,
            "error": str(e),
        }


def despachar_alerta_externa(texto: str) -> dict[str, Any]:
    """Envía la alerta por el canal automático de Telegram."""
    res = {}
    if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID:
        res["telegram"] = enviar_telegram_automatico(texto)
    return res
