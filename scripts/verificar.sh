#!/bin/bash
# Verifica toda la cadena en la EC2: contenedores, Orion, CrateDB (RAW), DWH, API, IA, Grafana,
# ETL recursivo bajo demanda (sin ciclos), modelo predictivo y WebSocket.
# Uso (en la EC2):  cd ~/agroiot && bash scripts/verificar.sh
cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env; set +a
DC="docker compose"; [ -w /var/run/docker.sock ] || DC="sudo docker compose"
ok()  { printf '  \033[32mOK\033[0m    %s\n' "$*"; }
mal() { printf '  \033[31mFALLA\033[0m %s\n' "$*"; FALLAS=$((FALLAS+1)); }
FALLAS=0
json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

echo "== Contenedores"
for s in $($DC ps --services); do
  st=$($DC ps --format '{{.Status}}' "$s")
  case "$st" in Up*) ok "$s ($st)";; *) mal "$s ($st)";; esac
done

echo "== Orion (contexto)"
E=$(curl -s "http://localhost:1036/v2/entities/${DEVICE_ID}?options=keyValues" -H 'fiware-service: openiot' -H 'fiware-servicepath: /')
echo "$E" | grep -q '"temperature"' && ok "entidad ${DEVICE_ID}: $E" || mal "sin entidad ${DEVICE_ID} (envia una lectura: bash scripts/probar_sensor.sh)"

echo "== CrateDB (RAW, via QuantumLeap)"
C=$(curl -s -u "iot:${CRATE_PASSWORD}" -H 'Content-Type: application/json' \
  -d '{"stmt":"SELECT count(*), max(time_index) FROM mtopeniot.etplantsensor"}' http://localhost:4200/_sql)
N=$(echo "$C" | json 'd["rows"][0][0]')
[ -n "$N" ] && [ "$N" -gt 0 ] && ok "$N filas en mtopeniot.etplantsensor" || mal "CrateDB sin datos: $C"

echo "== ETL Recursivo (Ejecución bajo demanda sin ciclos)"
ETL_OUT=$($DC exec -T etl python etl.py --deploy 2>&1)
echo "$ETL_OUT" | grep -q "Despliegue ETL finalizado exitosamente\|ETL \[despliegue\] completado" && \
  ok "ETL recursivo ejecutado bajo demanda sin esperar ciclo de 5 min" || \
  mal "Fallo ejecución directa ETL: $ETL_OUT"

echo "== DWH (Postgres, cargado por el ETL)"
Q() { $DC exec -T dwh psql -U "${DWH_USER:-dwh}" -d "${DWH_DB:-plantas}" -tAc "$1" 2>&1; }
for t in lectura_limpia resumen_horario resumen_diario alerta prediccion_diaria; do
  n=$(Q "SELECT count(*) FROM $t")
  [[ "$n" =~ ^[0-9]+$ ]] && ok "$t: $n filas" || mal "$t: $n"
done

echo "== API & WebSocket"
EST=$(curl -s http://localhost/api/estado); echo "  /api/estado -> $EST"
echo "$EST" | grep -q '"db":true\|"db": *true' && ok "API conectada al DWH" || mal "API sin DWH"
echo "$EST" | grep -q '"ws_clientes"' && ok "Servicio WebSocket activo (/api/ws)" || mal "Sin soporte WebSocket"

TOKEN=$(curl -s -X POST http://localhost/api/login -H 'Content-Type: application/json' \
  -d "{\"usuario\":\"${FRONT_USER}\",\"password\":\"${FRONT_PASSWORD}\"}" | json 'd["token"]')
if [ -n "$TOKEN" ]; then
  ok "login"
  P=$(curl -s http://localhost/api/plantas -H "Authorization: Bearer $TOKEN")
  ok "/api/plantas -> $(echo "$P" | head -c 160)"

  echo "== Modelo Predictivo Agronómico (Datos Reales)"
  PRED=$(curl -s "http://localhost/api/plantas/${DEVICE_ID}/prediccion" -H "Authorization: Bearer $TOKEN")
  if echo "$PRED" | grep -q '"disponible"'; then
    DISP=$(echo "$PRED" | json 'd["disponible"]')
    if [ "$DISP" = "True" ] || [ "$DISP" = "true" ]; then
      ok "Modelo predictivo calibrado con datos reales: $(echo "$PRED" | json 'd.get("recomendacion_agronomica", "")[:120]')"
    else
      ok "Modelo predictivo activo (esperando muestras reales sin inventar datos)"
    fi
  else
    mal "Endpoint predictivo no respondió: $PRED"
  fi

  echo "== Predicciones Multi-Día Guardadas en PostgreSQL (prediccion_diaria)"
  PRED_DB=$(curl -s "http://localhost/api/plantas/${DEVICE_ID}/predicciones-guardadas" -H "Authorization: Bearer $TOKEN")
  if echo "$PRED_DB" | grep -q '^\['; then
    ok "/api/plantas/${DEVICE_ID}/predicciones-guardadas -> $(echo "$PRED_DB" | json 'len(d)') registros en PostgreSQL"
  else
    mal "Endpoint predicciones-guardadas falló: $PRED_DB"
  fi

  if [ -n "${GEMINI_API_KEY:-}" ]; then
    R=$(curl -s -X POST http://localhost/api/chat -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "{\"pregunta\":\"Resume el estado de la planta en una frase\",\"planta\":\"${DEVICE_ID}\",\"historial\":[]}")
    echo "$R" | grep -q '"respuesta"' && ok "IA Gemini: $(echo "$R" | json 'd["respuesta"][:160]')" || mal "IA: $(echo "$R" | head -c 300)"
  else
    mal "GEMINI_API_KEY vacia en .env (el asistente no respondera)"
  fi
else
  mal "login fallo"
fi

echo "== Grafana"
[ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health)" = 200 ] && ok "Grafana responde" || mal "Grafana no responde"

echo; [ $FALLAS = 0 ] && echo "TODO OK" || echo "$FALLAS falla(s)"
exit $FALLAS
