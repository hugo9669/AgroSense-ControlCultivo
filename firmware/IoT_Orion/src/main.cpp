// =====================================================================================
//  AgroIoT - End device (LilyGO TTGO T-Beam / ESP32)
//  Sensores:
//    - ClosedCube HDC1080 (I2C 0x40): temperatura y humedad del aire
//    - AP3216 (I2C): luz ambiental (lux)
//    - Sensor capacitivo/resistivo de humedad de suelo (salida analogica, GPIO39 / ADC1)
//  Envia un JSON por HTTP al Agente IoT de FIWARE (a traves de nginx :80 en la EC2).
//
//  CONFIGURACION: copia include/secrets.example.h como include/secrets.h y completa tus datos.
// =====================================================================================
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <AP3216_WE.h>
#include <ClosedCube_HDC1080.h>

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Falta include/secrets.h: copia include/secrets.example.h como secrets.h y completa WiFi, IP y apikey"
#endif

// Intervalo de lectura/envio (30 s). El ETL agrega por hora/dia, asi que puede subirse sin problema.
#define INTERVALO_LECTURA_MS (30UL * 1000UL)

// I2C (T-Beam)
#define SDA_PIN 21
#define SCL_PIN 22
#define HDC1080_ADDR 0x40
#define HDC1080_MANUFACTURER_ID 0x5449   // "TI"

// Humedad de suelo (solo salida analogica, ADC1). Calibrar: valor RAW en aire seco y en agua.
#define PIN_HUMEDAD_ANALOG 39
#define HUMEDAD_RAW_SECO   4095
#define HUMEDAD_RAW_MOJADO 2300   // provisional: medir con el sensor sumergido
#define UMBRAL_SECO_PCT    30

// Valor centinela: el ETL lo detecta como fuera de rango y genera una alerta de "falla del sensor"
#define LECTURA_INVALIDA -999.0f

AP3216_WE ap3216 = AP3216_WE(&Wire);
ClosedCube_HDC1080 hdc1080;
char urlServidor[192];

bool hdc1080Presente() {
  return hdc1080.readManufacturerId() == HDC1080_MANUFACTURER_ID;
}

float leerTemperatura() {
  if (!hdc1080Presente()) return LECTURA_INVALIDA;
  float t = hdc1080.readTemperature();
  return isnan(t) ? LECTURA_INVALIDA : t;
}

float leerHumedadAire() {
  if (!hdc1080Presente()) return LECTURA_INVALIDA;
  float h = hdc1080.readHumidity();
  return isnan(h) ? LECTURA_INVALIDA : h;
}

void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.printf("Conectando a Wi-Fi: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int intentos = 0;
  while (WiFi.status() != WL_CONNECTED && intentos < 30) {
    delay(500);
    Serial.print(".");
    intentos++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[OK] Conectado. IP local: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[ERROR] No se pudo conectar a Wi-Fi (se reintenta en el proximo ciclo).");
  }
}

void enviarDatosServidor(float temp, float humAire, float lux, int humSueloPorc, int humSueloRaw, bool seco) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.setTimeout(10000);
  http.begin(urlServidor);
  http.addHeader("Content-Type", "application/json");

  // Claves EXACTAS que mapea scripts/provisionar.sh (object_id del dispositivo)
  char jsonPayload[256];
  snprintf(jsonPayload, sizeof(jsonPayload),
    "{\"temperatura_aire\":%.2f,\"humedad_aire\":%.2f,\"luz_lux\":%.2f,"
    "\"humedad_suelo_pct\":%d,\"humedad_suelo_raw\":%d,\"alerta_seco\":%s}",
    temp, humAire, lux, humSueloPorc, humSueloRaw, seco ? "true" : "false");

  int httpCode = http.POST(jsonPayload);
  if (httpCode > 0) {
    Serial.printf("[HTTP] Respuesta servidor: %d %s\n", httpCode, httpCode == 200 ? "(OK)" : "");
  } else {
    Serial.printf("[HTTP] Error enviando POST: %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- AgroIoT: monitoreo de cultivo ---");

  snprintf(urlServidor, sizeof(urlServidor), "http://%s:%d/iot/json?k=%s&i=%s",
           SERVER_HOST, SERVER_PORT, IOTA_APIKEY, DEVICE_ID);
  Serial.printf("Servidor: %s\n", urlServidor);

  pinMode(PIN_HUMEDAD_ANALOG, INPUT);

  Wire.begin(SDA_PIN, SCL_PIN, 100000);
  hdc1080.begin(HDC1080_ADDR);
  if (!hdc1080Presente()) Serial.println("[AVISO] HDC1080 no detectado: se enviaran lecturas invalidas (-999)");

  ap3216.init();
  ap3216.setMode(AP3216_ALS_PS);

  conectarWiFi();
}

void loop() {
  static unsigned long ultimaLectura = 0;
  static bool primeraLectura = true;

  if (primeraLectura || millis() - ultimaLectura >= INTERVALO_LECTURA_MS) {
    primeraLectura = false;
    ultimaLectura = millis();

    if (WiFi.status() != WL_CONNECTED) conectarWiFi();

    float tempAire = leerTemperatura();
    float humAire  = leerHumedadAire();
    float lux      = ap3216.getAmbientLight();

    int humedadSueloRaw = analogRead(PIN_HUMEDAD_ANALOG);
    int humedadSueloPorcentaje = map(humedadSueloRaw, HUMEDAD_RAW_SECO, HUMEDAD_RAW_MOJADO, 0, 100);
    humedadSueloPorcentaje = constrain(humedadSueloPorcentaje, 0, 100);
    bool estaSeco = (humedadSueloPorcentaje < UMBRAL_SECO_PCT);

    Serial.println("=== MONITOREO DE PLANTA ===");
    Serial.printf("Temp / Hum Aire : %.2f C | %.2f %%\n", tempAire, humAire);
    Serial.printf("Luz Ambiental   : %.2f lux\n", lux);
    Serial.printf("Humedad Suelo   : %d %% (RAW: %d)\n", humedadSueloPorcentaje, humedadSueloRaw);
    Serial.printf("Alerta seco     : %s\n", estaSeco ? "SI" : "NO");

    enviarDatosServidor(tempAire, humAire, lux, humedadSueloPorcentaje, humedadSueloRaw, estaSeco);
    Serial.println("---------------------------\n");
  }
}