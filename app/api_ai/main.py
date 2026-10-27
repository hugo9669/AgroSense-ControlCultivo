"""API AgroIoT: lee el DWH (Postgres) y expone plantas, historial, alertas, chat IA,
modelo predictivo multi-día persistido en PostgreSQL, WebSocket en tiempo real y alertas WhatsApp.

Login sencillo: usuario/clave del .env -> token firmado con HMAC (8 h).
Rutas /api/login, /api/estado y /api/ws no exigen token para conexión inicial.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any

import psycopg
from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

import ia
import notificaciones
import predictivo

DSN = os.environ["DWH_DSN"]
FRONT_USER = os.environ["FRONT_USER"]
FRONT_PASSWORD = os.environ["FRONT_PASSWORD"]
AUTH_SECRET = os.environ["AUTH_SECRET"].encode()
TOKEN_TTL = 8 * 3600

app = FastAPI(title="AgroIoT API", docs_url="/api/docs", openapi_url="/api/openapi.json")


# ---------------- Gestor de WebSocket y Notificaciones en Tiempo Real ----------------
class NotificadorWebSocket:
    def __init__(self) -> None:
        self.conexiones: list[WebSocket] = []
        self.historial: list[dict[str, Any]] = []

    async def conectar(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.conexiones.append(websocket)
        for notif in self.historial[-3:]:
            try:
                await websocket.send_json(notif)
            except Exception:
                pass

    def desconectar(self, websocket: WebSocket) -> None:
        if websocket in self.conexiones:
            self.conexiones.remove(websocket)

    async def emitir(self, mensaje: dict[str, Any]) -> None:
        self.historial.append(mensaje)
        if len(self.historial) > 50:
            self.historial.pop(0)

        desconectados = []
        for ws in self.conexiones:
            try:
                await ws.send_json(mensaje)
            except Exception:
                desconectados.append(ws)

        for ws in desconectados:
            self.desconectar(ws)


notificador = NotificadorWebSocket()


# ---------------- Autenticacion ----------------
def _sign(payload: str) -> str:
    return hmac.new(AUTH_SECRET, payload.encode(), hashlib.sha256).hexdigest()


def make_token(user: str) -> str:
    payload = f"{user}:{int(time.time()) + TOKEN_TTL}"
    return base64.urlsafe_b64encode(f"{payload}:{_sign(payload)}".encode()).decode()


def require_auth(authorization: str = Header(default="")):
    try:
        raw = base64.urlsafe_b64decode(authorization.removeprefix("Bearer ").encode()).decode()
        user, exp, sig = raw.rsplit(":", 2)
        ok = hmac.compare_digest(sig, _sign(f"{user}:{exp}")) and int(exp) > time.time()
    except Exception:
        ok = False
    if not ok:
        raise HTTPException(status_code=401, detail="No autenticado")


class Login(BaseModel):
    usuario: str
    password: str


@app.post("/api/login")
def login(b: Login):
    ok_user = hmac.compare_digest(b.usuario.encode(), FRONT_USER.encode())
    ok_pass = hmac.compare_digest(b.password.encode(), FRONT_PASSWORD.encode())
    if not (ok_user and ok_pass):
        raise HTTPException(status_code=401, detail="Credenciales invalidas")
    return {"token": make_token(b.usuario), "usuario": b.usuario, "expira_en": TOKEN_TTL}


# ---------------- WebSocket Endpoint ----------------
@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket):
    await notificador.conectar(websocket)
    try:
        while True:
            texto = await websocket.receive_text()
            if texto == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        notificador.desconectar(websocket)
    except Exception:
        notificador.desconectar(websocket)


class NotificacionPayload(BaseModel):
    tipo: str = "info"  # "alerta" | "prediccion" | "etl_sincronizado" | "info"
    titulo: str
    mensaje: str
    severidad: str = "info"
    ts: str | None = None
    datos: dict[str, Any] = Field(default_factory=dict)


@app.post("/api/notificaciones/emitir")
async def emitir_notificacion_externa(n: NotificacionPayload):
    """Emite la notificación a WebSockets y a WhatsApp si aplica."""
    texto_wa = notificaciones.formatear_mensaje_whatsapp(n.tipo, n.titulo, n.mensaje, n.datos)
    link_wa = notificaciones.generar_link_whatsapp(texto_wa)

    msg = {
        "tipo": n.tipo,
        "titulo": n.titulo,
        "mensaje": n.mensaje,
        "severidad": n.severidad,
        "ts": n.ts or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "datos": n.datos,
        "whatsapp_texto": texto_wa,
        "whatsapp_link": link_wa,
    }
    await notificador.emitir(msg)

    # Intento de envío automático por WhatsApp / Telegram si es crítica
    if n.severidad in ("warning", "error") or n.tipo == "prediccion":
        notificaciones.despachar_alerta_externa(texto_wa)

    return {"status": "ok", "clientes_conectados": len(notificador.conexiones), "whatsapp_link": link_wa}


# ---------------- Datos del DWH ----------------
def q(sql: str, *args: Any):
    try:
        with psycopg.connect(DSN, row_factory=dict_row, connect_timeout=5) as c:
            return c.execute(sql, args).fetchall()
    except psycopg.OperationalError:
        raise HTTPException(status_code=503, detail="Base de datos no disponible")


@app.get("/api/estado")
def estado():
    try:
        q("SELECT 1")
        db = True
    except HTTPException:
        db = False
    return {
        "api": True,
        "db": db,
        "ia": ia.configurada(),
        "modelo": ia.GEMINI_MODEL,
        "ws_clientes": len(notificador.conexiones),
        "whatsapp_habilitado": bool(notificaciones.WHATSAPP_PHONE and notificaciones.WHATSAPP_APIKEY),
        "telegram_habilitado": bool(notificaciones.TELEGRAM_BOT_TOKEN and notificaciones.TELEGRAM_CHAT_ID),
    }


@app.get("/api/plantas", dependencies=[Depends(require_auth)])
def plantas():
    return q("SELECT DISTINCT ON (entity_id) * FROM lectura_limpia ORDER BY entity_id, ts DESC")


@app.get("/api/plantas/{pid}/lecturas", dependencies=[Depends(require_auth)])
def lecturas(pid: str, limit: int = Query(60, ge=1, le=1000)):
    rows = q("SELECT * FROM lectura_limpia WHERE entity_id=%s ORDER BY ts DESC LIMIT %s", pid, limit)
    return rows[::-1]


@app.get("/api/plantas/{pid}/historial", dependencies=[Depends(require_auth)])
def historial(pid: str, horas: int = Query(24, ge=1, le=24 * 31)):
    return q("SELECT * FROM resumen_horario WHERE entity_id=%s "
             "AND hora > now() - make_interval(hours => %s::int) ORDER BY hora", pid, horas)


@app.get("/api/plantas/{pid}/diario", dependencies=[Depends(require_auth)])
def diario(pid: str, dias: int = Query(30, ge=1, le=365)):
    return q("SELECT * FROM resumen_diario WHERE entity_id=%s "
             "AND dia > current_date - %s::int ORDER BY dia", pid, dias)


@app.get("/api/alertas", dependencies=[Depends(require_auth)])
def alertas(limit: int = Query(50, ge=1, le=500), planta: str | None = None):
    if planta:
        return q("SELECT * FROM alerta WHERE entity_id=%s ORDER BY ts DESC LIMIT %s", planta, limit)
    return q("SELECT * FROM alerta ORDER BY ts DESC LIMIT %s", limit)


@app.get("/api/alertas/resumen", dependencies=[Depends(require_auth)])
def alertas_resumen(planta: str | None = None):
    rows = q("""
        SELECT severidad,
               count(*) FILTER (WHERE ts > now() - interval '24 hours') AS h24,
               count(*) FILTER (WHERE ts > now() - interval '7 days')   AS d7
        FROM alerta WHERE (%s::text IS NULL OR entity_id = %s) GROUP BY severidad""", planta, planta)
    out = {"error": {"h24": 0, "d7": 0}, "warning": {"h24": 0, "d7": 0}}
    for r in rows:
        out[r["severidad"]] = {"h24": r["h24"], "d7": r["d7"]}
    return out


# ---------------- Modelo Predictivo (Persistido en PostgreSQL) ----------------
@app.get("/api/plantas/{pid}/prediccion", dependencies=[Depends(require_auth)])
async def obtener_prediccion(pid: str, horas_futuro: int = Query(12, ge=1, le=48), dias_futuro: int = Query(7, ge=1, le=14)):
    """Calcula el modelo predictivo sobre lecturas reales y persiste las predicciones en la tabla 'prediccion_diaria'."""
    filas = q(
        "SELECT ts, soil_moisture, temperature, humidity, luminosity "
        "FROM lectura_limpia WHERE entity_id=%s AND soil_moisture IS NOT NULL "
        "ORDER BY ts DESC LIMIT 120", pid
    )
    cronologicas = filas[::-1]
    res = predictivo.entrenar_y_predecir(cronologicas, umbral_riego_pct=30.0, horas_futuro=horas_futuro, dias_futuro=dias_futuro)
    res["entity_id"] = pid

    # Guardar en la tabla de predicciones en PostgreSQL si el modelo está calibrado
    if res.get("disponible") and res.get("predicciones_diarias"):
        try:
            with psycopg.connect(DSN, autocommit=True) as c:
                predictivo.guardar_predicciones_en_db(c.cursor(), pid, res["predicciones_diarias"])
        except Exception as e:
            print("Aviso al guardar predicciones en PostgreSQL:", e, flush=True)

    # Si hay una alerta predictiva crítica, emitir por WebSocket y WhatsApp
    if res.get("disponible") and res.get("alerta_predictiva"):
        ap = res["alerta_predictiva"]
        h_riego = res.get("horas_hasta_riego")
        msg_datos = {
            "planta_id": pid,
            "humedad_actual": res.get("humedad_actual"),
            "horas_hasta_riego": h_riego,
            "tasa_cambio": res.get("tasa_cambio_por_hora"),
            "tendencia": res.get("tendencia"),
        }
        texto_wa = notificaciones.formatear_mensaje_whatsapp("prediccion", f"Déficit Hídrico · {pid}", ap["mensaje"], msg_datos)
        link_wa = notificaciones.generar_link_whatsapp(texto_wa)
        res["whatsapp_link"] = link_wa

        await notificador.emitir({
            "tipo": "prediccion",
            "titulo": f"Alerta Predictiva · {pid}",
            "mensaje": ap["mensaje"],
            "severidad": ap.get("severidad", "warning"),
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "datos": msg_datos,
            "whatsapp_link": link_wa,
        })

        # Envío a WhatsApp y Telegram si el déficit ocurrirá en menos de 6 horas
        if h_riego is not None and h_riego <= 6.0:
            notificaciones.despachar_alerta_externa(texto_wa)

    return res


@app.get("/api/plantas/{pid}/predicciones-guardadas", dependencies=[Depends(require_auth)])
def predicciones_guardadas(pid: str):
    """Consulta directa a la tabla 'prediccion_diaria' en PostgreSQL con los cálculos de siguientes días."""
    return q(
        "SELECT entity_id, fecha_proyectada::text, fecha_calculo::text, dias_adelante, "
        "soil_moisture_pred, temp_pred, hum_pred, tendencia, tasa_cambio_diaria, "
        "horas_hasta_riego, requiere_riego, r2, recomendacion "
        "FROM prediccion_diaria WHERE entity_id=%s AND fecha_proyectada >= current_date "
        "ORDER BY fecha_proyectada ASC", pid
    )


class MensajeWhatsAppInput(BaseModel):
    texto: str
    telefono: str = ""


@app.post("/api/notificaciones/whatsapp", dependencies=[Depends(require_auth)])
def enviar_whatsapp_directo(w: MensajeWhatsAppInput):
    """Permite el envío manual o de prueba de WhatsApp."""
    return notificaciones.enviar_whatsapp_automatico(w.texto, w.telefono)


class MensajeTelegramInput(BaseModel):
    texto: str
    chat_id: str = ""


@app.post("/api/notificaciones/telegram", dependencies=[Depends(require_auth)])
def enviar_telegram_directo(t: MensajeTelegramInput):
    """Permite el envío manual o de prueba de Telegram."""
    return notificaciones.enviar_telegram_automatico(t.texto, t.chat_id)


# ---------------- Disparador Bajo Demanda del ETL ----------------
@app.post("/api/etl/ejecutar", dependencies=[Depends(require_auth)])
def disparar_etl_on_demand():
    import subprocess
    cmd = ["python3", "/app/../etl/etl.py", "--deploy"]
    if not os.path.exists(cmd[1]):
        cmd = ["python3", "app/etl/etl.py", "--deploy"]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        return {
            "status": "completado" if proc.returncode == 0 else "error",
            "codigo_salida": proc.returncode,
            "stdout": proc.stdout[-500:],
            "stderr": proc.stderr[-500:],
        }
    except Exception as e:
        return {"status": "error", "detalle": str(e)}


# ---------------- IA (Gemini) ----------------
class Turno(BaseModel):
    rol: str = Field(pattern="^(user|ai)$")
    texto: str = Field(max_length=4000)


class Pregunta(BaseModel):
    pregunta: str = Field(min_length=1, max_length=1000)
    planta: str | None = None
    historial: list[Turno] = Field(default_factory=list, max_length=20)


@app.post("/api/chat", dependencies=[Depends(require_auth)])
def chat(p: Pregunta):
    if not ia.configurada():
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY no configurada en el servidor")
    todas = plantas()
    pid = p.planta or (todas[0]["entity_id"] if todas else None)
    ctx = {
        "planta_consultada": pid,
        "ultimas_lecturas_por_planta": todas,
        "umbrales_recomendados": {"temperature": [10, 35], "humidity": [30, 90],
                                  "luminosity": [1000, 80000], "soil_moisture": [20, 80]},
    }
    if pid:
        ctx["resumen_horario_24h"] = q(
            "SELECT hora, round(temp_avg::numeric,1) t, round(temp_min::numeric,1) tmin, "
            "round(temp_max::numeric,1) tmax, round(hum_avg::numeric,0) h, round(lux_avg::numeric,0) lux, "
            "round(soil_avg::numeric,0) suelo, n FROM resumen_horario "
            "WHERE entity_id=%s AND hora > now() - interval '24 hours' ORDER BY hora", pid)
        ctx["resumen_diario_7d"] = q(
            "SELECT * FROM resumen_diario WHERE entity_id=%s AND dia > current_date - 7 ORDER BY dia", pid)
        ctx["alertas_recientes"] = q(
            "SELECT ts, severidad, tipo, mensaje FROM alerta WHERE entity_id=%s ORDER BY ts DESC LIMIT 15", pid)

        # Incorporar predicciones persistidas en el contexto de Gemini
        preds_db = q(
            "SELECT fecha_proyectada::text, dias_adelante, soil_moisture_pred, requiere_riego, recomendacion "
            "FROM prediccion_diaria WHERE entity_id=%s AND fecha_proyectada >= current_date "
            "ORDER BY fecha_proyectada ASC LIMIT 7", pid)
        if preds_db:
            ctx["predicciones_siguientes_dias_db"] = preds_db

    contexto = json.dumps(ctx, default=str, ensure_ascii=False)
    historial = [t.model_dump() for t in p.historial[-8:]]
    return {"respuesta": ia.preguntar(contexto, p.pregunta, historial), "modelo": ia.GEMINI_MODEL}
