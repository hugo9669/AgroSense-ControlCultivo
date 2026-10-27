#!/bin/bash
# Instala y levanta AgroIoT en la EC2 (Ubuntu). Idempotente: correlo tambien cada vez que actualices el codigo.
# Uso (en la EC2):   cd ~/agroiot && sudo bash scripts/setup_ec2.sh
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
[ "$(id -u)" = 0 ] || { echo "Ejecutalo con sudo: sudo bash scripts/setup_ec2.sh"; exit 1; }
USUARIO=${SUDO_USER:-ubuntu}
paso() { echo; echo "======== $*"; }

paso "1/7 Docker"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 curl openssl
fi
systemctl enable --now docker
usermod -aG docker "$USUARIO" 2>/dev/null || true   # para usar docker sin sudo (tras volver a entrar por SSH)

paso "2/7 Parametro del kernel que exige CrateDB"
echo 'vm.max_map_count=262144' > /etc/sysctl.d/99-crate.conf   # persistente tras reinicios
sysctl -w vm.max_map_count=262144

paso "3/7 Detener el despliegue anterior (~/proyecto) si existe (sus volumenes NO se borran)"
OLD="/home/$USUARIO/proyecto/docker-compose.yml"
[ -f "$OLD" ] && (cd "$(dirname "$OLD")" && docker compose down) || true
# Contenedores sueltos con los mismos nombres que usa este proyecto pero de otro compose
for c in orion db-mongo db-crate grafana fiware-quantumleap iot-agent dwh-postgres etl api frontend; do
  proj=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$c" 2>/dev/null || true)
  if docker inspect "$c" >/dev/null 2>&1 && [ "$proj" != "agroiot" ]; then
    echo "Eliminando contenedor antiguo: $c"; docker rm -f "$c" >/dev/null
  fi
done

paso "4/7 Archivo .env"
bash scripts/generar_env.sh
chown "$USUARIO": .env
set -a; . ./.env; set +a

paso "5/7 CrateDB + usuario iot"
docker compose up -d crate-db || exit 1
bash scripts/crate_auth.sh || exit 1

paso "6/7 Construir y levantar todos los servicios (la primera vez tarda varios minutos)"
docker compose up -d --build --remove-orphans || exit 1

paso "7/8 Provisionar agente IoT y suscripcion Orion -> QuantumLeap"
for i in $(seq 1 60); do
  curl -sf http://localhost:4041/iot/about >/dev/null && curl -sf http://localhost:1036/version >/dev/null && break
  sleep 5
done
bash scripts/provisionar.sh localhost
PROV=$?

paso "8/8 Sincronización inmediata del ETL recursivo (sin esperar ciclo de 5 min)"
docker compose exec -T etl python etl.py --deploy || true

echo
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
cat <<EOF

=====================================================================
  AgroIoT desplegado $( [ $PROV = 0 ] && echo "OK" || echo "CON ERRORES EN EL APROVISIONAMIENTO (ver arriba)" )
---------------------------------------------------------------------
  Panel web ......: http://${PUBLIC_HOST}          usuario: ${FRONT_USER}
  Clave del panel : ${FRONT_PASSWORD}
  Orion ..........: http://${PUBLIC_HOST}:1036/version
  CrateDB UI .....: http://${PUBLIC_HOST}:4200     usuario: iot  clave: CRATE_PASSWORD del .env
  Grafana ........: http://${PUBLIC_HOST}:3000     usuario: admin clave: GRAFANA_ADMIN_PASSWORD del .env

  >>> Para el firmware (firmware/IoT_Orion/include/secrets.h):
      SERVER_HOST  "${PUBLIC_HOST}"
      IOTA_APIKEY  "${IOTA_APIKEY}"
      DEVICE_ID    "${DEVICE_ID}"
EOF
[ -n "${GEMINI_API_KEY:-}" ] || cat <<EOF

  AVISO: GEMINI_API_KEY esta vacia -> el asistente IA no respondera.
         nano .env   (pon tu clave)   y luego:  sudo docker compose up -d api
EOF
echo "====================================================================="
exit $PROV
