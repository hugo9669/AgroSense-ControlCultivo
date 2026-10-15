#!/bin/bash
# Crea .env a partir de .env.example reemplazando cada valor "CAMBIAR_..." por una clave aleatoria.
# Si .env ya existe NO lo toca (asi no se pierden las claves con las que se crearon las bases de datos).
cd "$(dirname "$0")/.." || exit 1
if [ -f .env ]; then
  echo "OK    .env ya existe (no se modifica)"
  exit 0
fi
while IFS= read -r linea || [ -n "$linea" ]; do
  case "$linea" in
    [A-Z]*=CAMBIAR_*) echo "${linea%%=*}=$(openssl rand -hex 16)" ;;
    *) echo "$linea" ;;
  esac
done < .env.example > .env
chmod 600 .env
echo "OK    .env creado con claves aleatorias"
