"""Cliente minimo de Gemini (Interactions API, REST) para el asistente agronomo.

Se usa REST con httpx (sin SDK) para mantener la imagen liviana.
Docs: POST https://generativelanguage.googleapis.com/v1/interactions
"""
import os
import time

import httpx
from fastapi import HTTPException

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")
# Respaldo si el principal esta saturado (503) o sin cuota (429). Vacio = sin respaldo.
GEMINI_MODEL_RESPALDO = os.environ.get("GEMINI_MODEL_RESPALDO", "gemini-3.5-flash-lite")
REINTENTABLES = {429, 500, 503}
URL = "https://generativelanguage.googleapis.com/v1/interactions"

SYSTEM = (
    "Eres AgroSense, un asistente agrónomo experto en cultivos monitoreados con sensores IoT. "
    "Responde SIEMPRE en español, de forma breve (máximo ~150 palabras salvo que pidan detalle), "
    "clara y accionable. Usa listas cortas con '-' cuando des recomendaciones y **negritas** para lo clave. "
    "Basa tus respuestas SOLO en los datos del sistema que se te entregan (lecturas limpias del DWH, "
    "resúmenes horarios y alertas). Si un dato falta o es nulo, dilo (puede ser falla del sensor). "
    "Variables: temperature (°C, aire), humidity (% aire), luminosity (lux), soil_moisture (% suelo). "
    "Cuando recomiendes riego o luz, justifica con los valores concretos y las tendencias."
)


def configurada() -> bool:
    return bool(GEMINI_API_KEY)


def _paso(rol: str, texto: str) -> dict:
    return {"type": "user_input" if rol == "user" else "model_output",
            "content": [{"type": "text", "text": texto}]}


def preguntar(contexto: str, pregunta: str, historial: list[dict]) -> str:
    """historial: [{'rol': 'user'|'ai', 'texto': str}, ...] (turnos previos, ya recortados)."""
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY no configurada en el servidor")

    pasos = [_paso(h["rol"], h["texto"]) for h in historial if h.get("texto")]
    pasos.append(_paso("user", f"DATOS DEL SISTEMA (JSON):\n{contexto}\n\nPREGUNTA: {pregunta}"))
    # La conversacion debe iniciar con un turno del usuario
    while pasos and pasos[0]["type"] != "user_input":
        pasos.pop(0)

    cuerpo = {
        "system_instruction": SYSTEM,
        "input": pasos,
        "store": False,  # no se guarda la conversacion en Google
        "generation_config": {"thinking_level": "low"},
    }
    # Modelo principal con 2 intentos y, si Google esta saturado, el de respaldo
    intentos = [(m, n) for m in dict.fromkeys([GEMINI_MODEL, GEMINI_MODEL_RESPALDO]) if m for n in range(2)]
    for i, (modelo, n) in enumerate(intentos):
        try:
            r = httpx.post(URL, timeout=45, headers={"x-goog-api-key": GEMINI_API_KEY},
                           json={"model": modelo, **cuerpo})
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Gemini tardó demasiado en responder")
        except httpx.HTTPError as e:
            raise HTTPException(status_code=504, detail=f"No se pudo contactar a Gemini: {e.__class__.__name__}")
        if r.status_code == 200:
            break
        try:  # mensaje de Google (modelo inexistente, clave invalida, cuota...): util para diagnosticar
            motivo = r.json()["error"]["message"]
        except (KeyError, TypeError, ValueError):
            motivo = r.text[:200]
        print(f"Gemini {modelo} (intento {n + 1}) -> {r.status_code}: {motivo}", flush=True)
        if r.status_code not in REINTENTABLES or i == len(intentos) - 1:
            raise HTTPException(status_code=502, detail=f"Gemini ({modelo}) respondió {r.status_code}: {motivo}"[:300])
        time.sleep(1.5 * (n + 1))

    try:
        pasos_resp = r.json().get("steps", [])
        textos = [c.get("text", "") for p in pasos_resp if p.get("type") == "model_output"
                  for c in p.get("content", []) if c.get("type") == "text"]
    except (AttributeError, TypeError, ValueError):
        textos = []
    texto = "".join(textos).strip()
    if not texto:  # p. ej. respuesta bloqueada por filtros de seguridad
        raise HTTPException(status_code=502, detail="Gemini devolvió una respuesta sin contenido")
    return texto
