#!/bin/bash
set -e

# Asegurar archivo de log de cron
mkdir -p /var/log
touch /var/log/cron.log

# Registrar el crontab en el sistema
if [ -f /app/crontab ]; then
    crontab /app/crontab
    echo "[CRON ETL] Crontab instalado correctamente."
fi

# Si se pasa un comando explícito al contenedor (p. ej. python etl.py), ejecutarlo y salir
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

# Ejecutar corrida inicial del ETL al levantar el contenedor
echo "[CRON ETL] Ejecutando sincronización inicial del ETL..."
python3 /app/etl.py || true

# Ejecutar el demonio cron en primer plano
echo "[CRON ETL] Iniciando demonio cron (ejecución programada cada 5 min)..."
cron
exec tail -f /var/log/cron.log
