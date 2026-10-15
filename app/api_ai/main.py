"""API AgroIoT: lee el DWH (Postgres) y expone plantas, historial, alertas y el chat con Gemini.

Login sencillo: usuario/clave del .env -> token firmado con HMAC (8 h). Todas las rutas /api/* salvo
/api/login y /api/estado exigen 'Authorization: Bearer <token>'.
"""
import base64
import hashlib
import hmac
import json
import os
import time

import psycopg
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

import ia

DSN = os.environ["DWH_DSN"]
FRONT_USER = os.environ["FRONT_USER"]
FRONT_PASSWORD = os.environ["FRONT_PASSWORD"]
AUTH_SECRET = os.environ["AUTH_SECRET"].encode()
TOKEN_TTL = 8 * 3600

app = FastAPI(title="AgroIoT API", docs_url="/api/docs", openapi_url="/api/openapi.json")


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


# ---------------- Datos ----------------
def q(sql, *args):
    try:
        with psycopg.connect(DSN, row_factory=dict_row, connect_timeout=5) as c:
            return c.execute(sql, args).fetchall()
    except psycopg.OperationalError:
        raise HTTPException(status_code=503, detail="Base de datos no disponible")


@app.get("/api/estado")
def estado():
    """Salud del sistema (publica, sin datos sensibles): la usa el front para el indicador de conexion."""
    try:
        q("SELECT 1")
        db = True
    except HTTPException:
        db = False
    return {"api": True, "db": db, "ia": ia.configurada(), "modelo": ia.GEMINI_MODEL}


@app.get("/api/plantas", dependencies=[Depends(require_auth)])
def plantas():
    """Ultima lectura limpia de cada planta."""
    return q("SELECT DISTINCT ON (entity_id) * FROM lectura_limpia ORDER BY entity_id, ts DESC")


@app.get("/api/plantas/{pid}/lecturas", dependencies=[Depends(require_auth)])
def lecturas(pid: str, limit: int = Query(60, ge=1, le=1000)):
    """Ultimas lecturas limpias (orden cronologico): sparklines del resumen."""
    rows = q("SELECT * FROM lectura_limpia WHERE entity_id=%s ORDER BY ts DESC LIMIT %s", pid, limit)
    return rows[::-1]


@app.get("/api/plantas/{pid}/historial", dependencies=[Depends(require_auth)])
def historial(pid: str, horas: int = Query(24, ge=1, le=24 * 31)):
    """Resumen horario de las ultimas N horas."""
    return q("SELECT * FROM resumen_horario WHERE entity_id=%s "
             "AND hora > now() - make_interval(hours => %s::int) ORDER BY hora", pid, horas)


@app.get("/api/plantas/{pid}/diario", dependencies=[Depends(require_auth)])
def diario(pid: str, dias: int = Query(30, ge=1, le=365)):
    """Resumen diario de los ultimos N dias."""
    return q("SELECT * FROM resumen_diario WHERE entity_id=%s "
             "AND dia > current_date - %s::int ORDER BY dia", pid, dias)


@app.get("/api/alertas", dependencies=[Depends(require_auth)])
def alertas(limit: int = Query(50, ge=1, le=500), planta: str | None = None):
    if planta:
        return q("SELECT * FROM alerta WHERE entity_id=%s ORDER BY ts DESC LIMIT %s", planta, limit)
    return q("SELECT * FROM alerta ORDER BY ts DESC LIMIT %s", limit)


@app.get("/api/alertas/resumen", dependencies=[Depends(require_auth)])
def alertas_resumen(planta: str | None = None):
    """Conteos de alertas (24 h y 7 dias) por severidad."""
    rows = q("""
        SELECT severidad,
               count(*) FILTER (WHERE ts > now() - interval '24 hours') AS h24,
               count(*) FILTER (WHERE ts > now() - interval '7 days')   AS d7
        FROM alerta WHERE (%s::text IS NULL OR entity_id = %s) GROUP BY severidad""", planta, planta)
    out = {"error": {"h24": 0, "d7": 0}, "warning": {"h24": 0, "d7": 0}}
    for r in rows:
        out[r["severidad"]] = {"h24": r["h24"], "d7": r["d7"]}
    return out


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
    contexto = json.dumps(ctx, default=str, ensure_ascii=False)
    historial = [t.model_dump() for t in p.historial[-8:]]
    return {"respuesta": ia.preguntar(contexto, p.pregunta, historial), "modelo": ia.GEMINI_MODEL}
