#!/bin/bash
# Simula el ESP32: envia una lectura por el mismo camino que el sensor real (nginx :80 -> agente IoT -> Orion)
# y muestra como quedo la entidad en Orion.
# Uso (en la EC2):  bash scripts/probar_sensor.sh [temp] [hum_aire] [lux] [suelo_pct]
#   ej. lectura con suelo seco:   bash scripts/probar_sensor.sh 27 55 12000 12
cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env; set +a
T=${1:-24.5}; HA=${2:-60}; LX=${3:-15000}; S=${4:-45}
SECO=false; [ "${S%.*}" -lt 30 ] && SECO=true

code=$(curl -s -o /tmp/sensor.out -w '%{http_code}' -X POST \
  "http://localhost/iot/json?k=${IOTA_APIKEY}&i=${DEVICE_ID}" -H 'Content-Type: application/json' \
  -d "{\"temperatura_aire\":$T,\"humedad_aire\":$HA,\"luz_lux\":$LX,\"humedad_suelo_pct\":$S,\"humedad_suelo_raw\":2500,\"alerta_seco\":$SECO}")
echo "Agente IoT respondio HTTP $code $(cat /tmp/sensor.out)"
sleep 1
echo "Entidad en Orion:"
curl -s "http://localhost:1036/v2/entities/${DEVICE_ID}?options=keyValues" \
  -H 'fiware-service: openiot' -H 'fiware-servicepath: /'
echo
echo "El ETL la pasara al DWH en <= 5 min (docker logs -f etl)."
