#pragma once
// =====================================================================================
//  PLANTILLA DE SECRETOS DEL FIRMWARE
//  1. Copia este archivo en la misma carpeta con el nombre  secrets.h
//  2. Completa los valores marcados con  <-- CAMBIAR
//  secrets.h esta en .gitignore: tus claves WiFi nunca se suben al repositorio.
// =====================================================================================

// --- Red WiFi a la que se conecta el T-Beam (solo 2.4 GHz) ---
#define WIFI_SSID      "NOMBRE_DE_TU_WIFI"     // <-- CAMBIAR
#define WIFI_PASSWORD  "CLAVE_DE_TU_WIFI"      // <-- CAMBIAR ("" si la red es abierta)

// --- Servidor (EC2) ---
// IP publica de la instancia. OJO: no es IP elastica; si detienes/inicias la EC2 cambia
// y hay que actualizarla aqui y volver a flashear.
#define SERVER_HOST    "32.193.138.160"         // <-- CAMBIAR si cambia la IP
// 80 = entra por nginx (/iot/json), no requiere abrir puertos extra.
// 7896 = directo al agente IoT (solo si abriste ese puerto en el Security Group).
#define SERVER_PORT    80

// --- Seguridad y Cifrado en Envío del End Device ---
// true para cifrado TLS/HTTPS en tránsito (puerto 443 con WiFiClientSecure), false para HTTP plano
#define USE_HTTPS      false
#define SERVER_HTTPS_PORT 443
// Clave simétrica compartida para autenticación e integridad criptográfica con HMAC-SHA256
#define HMAC_SECRET_KEY "agrosense_clave_secreta_firmware_2026"

// --- Servidor Secundario (opcional) ---
#define SERVER_IP_2    ""

// --- Agente IoT ---
// Debe ser IGUAL a IOTA_APIKEY del archivo .env del servidor
// (scripts/setup_ec2.sh lo imprime al final; tambien: grep IOTA_APIKEY ~/agroiot/.env)
#define IOTA_APIKEY    "PEGA_AQUI_TU_IOTA_APIKEY"   // <-- CAMBIAR
#define DEVICE_ID      "planta01"                   // = DEVICE_ID del .env
