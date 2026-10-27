"""Módulo de Notificaciones Multicanal para AgroSense: WebSocket y WhatsApp.

Soporta:
1. Notificaciones en tiempo real vía WebSocket a la interfaz web.
2. Notificaciones automatizadas a WhatsApp (CallMeBot API / Twilio).
3. Generación de enlaces directos instantáneos (wa.me) para compartir con 1 clic.
"""
from __future__ import annotations

import os
import urllib.parse
from typing import Any

try:
    import requests
except ImportError:
    requests = None

WHATSAPP_PHONE = os.environ.get("WHATSAPP_PHONE", "")
WHATSAPP_APIKEY = os.environ.get("WHATSAPP_APIKEY", "")  # CallMeBot apikey
TWILIO_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM = os.environ.get("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")


def formatear_mensaje_whatsapp(tipo: str, titulo: str, mensaje: str, datos: dict[str, Any] | None = None) -> str:
    """Genera un mensaje de WhatsApp enriquecido con formato y emojis agronómicos."""
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
        f"🌐 Revisa el panel de control: /#resumen"
    )


def generar_link_whatsapp(texto: str, telefono: str = "") -> str:
    """Genera una URL wa.me para abrir WhatsApp Web o móvil con el mensaje preformateado."""
    texto_encoded = urllib.parse.quote(texto)
    if telefono:
        tel_limpio = "".join(c for c in telefono if c.isdigit())
        return f"https://wa.me/{tel_limpio}?text={texto_encoded}"
    return f"https://wa.me/?text={texto_encoded}"


def enviar_whatsapp_automatico(texto: str, telefono: str = "", apikey: str = "") -> dict[str, Any]:
    """Envía un mensaje a WhatsApp a través del gateway CallMeBot o Twilio si están configurados."""
    tel = telefono or WHATSAPP_PHONE
    key = apikey or WHATSAPP_APIKEY

    if not tel or not key or requests is None:
        return {
            "enviado": False,
            "motivo": "Credenciales de WhatsApp (WHATSAPP_PHONE / WHATSAPP_APIKEY) no configuradas en .env",
            "link_manual": generar_link_whatsapp(texto, tel),
        }

    try:
        # CallMeBot API: https://api.callmebot.com/whatsapp.php?phone=[phone]&text=[text]&apikey=[apikey]
        url = "https://api.callmebot.com/whatsapp.php"
        params = {"phone": tel, "text": texto, "apikey": key}
        r = requests.get(url, params=params, timeout=10)
        exito = r.status_code == 200 and "Message queued" in r.text or "ok" in r.text.lower()
        return {
            "enviado": exito,
            "status_code": r.status_code,
            "respuesta": r.text[:200],
            "link_manual": generar_link_whatsapp(texto, tel),
        }
    except Exception as e:
        return {
            "enviado": False,
            "error": str(e),
            "link_manual": generar_link_whatsapp(texto, tel),
        }
