#!/bin/bash
# Crea (o actualiza) el usuario 'iot' de CrateDB con la clave CRATE_PASSWORD del .env y le da todos los privilegios.
# El superusuario integrado 'crate' no admite clave; se usa solo para esto, via _local_ (trust, dentro del contenedor).
# Idempotente.
cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env; set +a
for i in $(seq 1 60); do
  docker exec db-crate crash -c "CREATE USER iot WITH (password = '${CRATE_PASSWORD}');" >/dev/null 2>&1 \
  || docker exec db-crate crash -c "ALTER USER iot SET (password = '${CRATE_PASSWORD}');" >/dev/null 2>&1
  if docker exec db-crate crash -c "GRANT ALL PRIVILEGES TO iot;" >/dev/null 2>&1; then
    echo "OK usuario iot de CrateDB listo"; exit 0
  fi
  sleep 3
done
echo "FALLO: no se pudo configurar el usuario iot en CrateDB"; exit 1
