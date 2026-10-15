#!/bin/bash
# Provisiona el Agente IoT JSON (grupo de servicio + dispositivo) y la suscripcion Orion -> QuantumLeap.
# Lee IOTA_APIKEY y DEVICE_ID del .env. Idempotente: si algo ya existe (409) se considera correcto.
# Uso (en la EC2):  bash scripts/provisionar.sh            (HOST por defecto: localhost)
cd "$(dirname "$0")/.." || exit 1
[ -f .env ] || { echo "FALLO: no existe .env (corre primero scripts/generar_env.sh)"; exit 1; }
set -a; . ./.env; set +a

HOST=${1:-localhost}
APIKEY=${IOTA_APIKEY:?define IOTA_APIKEY en .env}
DEVICE=${DEVICE_ID:-planta01}
H=(-H 'fiware-service: openiot' -H 'fiware-servicepath: /')
FALLO=0

post() {  # post <nombre> <url> <json>
  local code
  code=$(curl -s -o /tmp/prov.out -w '%{http_code}' -X POST "$2" "${H[@]}" -H 'Content-Type: application/json' -d "$3")
  case "$code" in
    200|201|204|409) echo "OK    $1 (HTTP $code)";;
    *) echo "FALLO $1 (HTTP $code): $(cat /tmp/prov.out)"; FALLO=1;;
  esac
}

# El agente busca el dispositivo por {id, service, subservice, apikey}. Si llega una lectura entre el borrado
# y la recreacion, autocrea un duplicado "PlantSensor:<id>" sin mapeo: por eso se verifica que quede uno solo.
device_ok() {
  local out; out=$(curl -s "http://$HOST:4041/iot/devices" "${H[@]}")
  [ "$(echo "$out" | grep -o '"device_id"' | wc -l)" = "1" ] && echo "$out" | grep -q "\"entity_name\":\"$DEVICE\""
}

for intento in 1 2 3 4 5; do
  for i in 1 2 3 4 5; do
    c=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "http://$HOST:4041/iot/devices/$DEVICE" "${H[@]}")
    [ "$c" = "404" ] && break
  done
  curl -s -o /dev/null -X DELETE "http://$HOST:4041/iot/services?resource=/iot/json&apikey=$APIKEY" "${H[@]}"

  post "grupo de servicio (apikey)" "http://$HOST:4041/iot/services" '{
    "services": [{"apikey": "'"$APIKEY"'", "cbroker": "http://orion:1026",
                  "entity_type": "PlantSensor", "resource": "/iot/json"}]}'

  # object_id = clave EXACTA del JSON que envia el firmware (firmware/IoT_Orion/src/main.cpp)
  post "dispositivo $DEVICE" "http://$HOST:4041/iot/devices" '{
    "devices": [{"device_id": "'"$DEVICE"'", "entity_name": "'"$DEVICE"'", "entity_type": "PlantSensor",
      "apikey": "'"$APIKEY"'", "transport": "HTTP",
      "attributes": [
        {"object_id": "temperatura_aire",  "name": "temperature",  "type": "Number"},
        {"object_id": "humedad_aire",      "name": "humidity",     "type": "Number"},
        {"object_id": "luz_lux",           "name": "luminosity",   "type": "Number"},
        {"object_id": "humedad_suelo_pct", "name": "soilMoisture", "type": "Number"},
        {"object_id": "humedad_suelo_raw", "name": "soilMoistureRaw", "type": "Number"},
        {"object_id": "alerta_seco",       "name": "dryAlert",     "type": "Boolean"}]}]}'

  sleep 2
  if device_ok; then echo "OK    dispositivo unico y mapeado"; break; fi
  echo "AVISO: aparecio un dispositivo duplicado, reintentando ($intento/5)"
  FALLO=0
done
device_ok || { echo "FALLO: sigue habiendo dispositivos duplicados"; FALLO=1; }

# Entidad autocreada sin mapeo (si la hubiera)
curl -s -o /dev/null -X DELETE "http://$HOST:1036/v2/entities/PlantSensor:$DEVICE?type=PlantSensor" "${H[@]}"

# Suscripcion Orion -> QuantumLeap (crea la tabla mtopeniot.etplantsensor en Crate). Solo si no existe.
if curl -s "http://$HOST:1036/v2/subscriptions" "${H[@]}" | grep -q 'Historico de plantas en QuantumLeap'; then
  echo "OK    suscripcion Orion->QuantumLeap (ya existia)"
else
  post "suscripcion Orion->QuantumLeap" "http://$HOST:1036/v2/subscriptions" '{
  "description": "Historico de plantas en QuantumLeap",
  "subject": {"entities": [{"idPattern": ".*", "type": "PlantSensor"}],
              "condition": {"attrs": ["temperature","humidity","luminosity","soilMoisture"]}},
  "notification": {"http": {"url": "http://quantumleap:8668/v2/notify"},
                   "attrs": ["temperature","humidity","luminosity","soilMoisture"],
                   "metadata": ["dateCreated","dateModified"]}}'
fi

exit $FALLO
