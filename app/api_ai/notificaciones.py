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
        f"🌐 Revisa el panel de control: http://32.193.138.160"
    )


def enviar_telegram_automatico(texto: str, chat_id: str = "", bot_token: str = "") -> dict[str, Any]:
    """Envía un mensaje a Telegram a través de la API oficial de bots de Telegram."""
    cid = chat_id or os.environ.get("TELEGRAM_CHAT_ID", "")
    tok = bot_token or os.environ.get("TELEGRAM_BOT_TOKEN", "")

    if not cid or not tok:
        return {
            "enviado": False,
            "motivo": "Credenciales de Telegram (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) no configuradas en .env",
        }

    try:
        url = f"https://api.telegram.org/bot{tok}/sendMessage"
        payload = json.dumps({
            "chat_id": str(cid),
            "text": texto,
            "parse_mode": "Markdown",
            "disable_web_page_preview": True,
        }).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            exito = bool(data.get("ok", False))
            return {
                "enviado": exito,
                "status_code": resp.status,
                "respuesta": data,
            }
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
