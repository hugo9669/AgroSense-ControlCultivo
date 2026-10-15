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

#define AP3216_ADDR  0x1E

AP3216_WE ap3216 = AP3216_WE(&Wire);
ClosedCube_HDC1080 hdc1080;
char urlServidor[192];

bool i2cResponde(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

bool hdc1080Presente() {
  return i2cResponde(HDC1080_ADDR) && hdc1080.readManufacturerId() == HDC1080_MANUFACTURER_ID;
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

// Si el AP3216 no responde, la libreria devuelve un numero basura: mejor enviar -999
float leerLux() {
  if (!i2cResponde(AP3216_ADDR)) return LECTURA_INVALIDA;
  return ap3216.getAmbientLight();
}

// Diagnostico: lista los dispositivos del bus I2C
void escanearI2C() {
  Serial.printf("Escaneando I2C (SDA=%d, SCL=%d)...\n", SDA_PIN, SCL_PIN);
  int n = 0;
  for (uint8_t a = 1; a < 127; a++) {
    if (!i2cResponde(a)) continue;
    n++;
    const char *nombre = a == HDC1080_ADDR ? "HDC1080 (temp/hum)" :
                         a == AP3216_ADDR  ? "AP3216 (luz)" :
                         a == 0x34         ? "AXP192/AXP2101 (energia del T-Beam)" :
                         a == 0x3C         ? "pantalla OLED" : "desconocido";
    Serial.printf("  0x%02X  %s\n", a, nombre);
  }
  if (n == 0) Serial.println("  [ERROR] Ningun dispositivo: revisa VCC=3.3V, GND comun, SDA->21 y SCL->22 (no invertidos)");
  if (!i2cResponde(HDC1080_ADDR)) Serial.println("  [AVISO] HDC1080 (0x40) no responde -> temp/hum = -999");
  if (!i2cResponde(AP3216_ADDR))  Serial.println("  [AVISO] AP3216 (0x1E) no responde -> luz = -999");
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
    wl_status_t st = WiFi.status();
    Serial.printf("\n[ERROR] No se pudo conectar a Wi-Fi \"%s\" (%s). Se reintenta en el proximo ciclo.\n", WIFI_SSID,
                  st == WL_NO_SSID_AVAIL ? "no encuentra esa red: revisa el nombre exacto y que sea 2.4 GHz" :
                  st == WL_CONNECT_FAILED ? "clave incorrecta o la red rechazo la conexion" : "sin respuesta del router");
    static bool listado = false;
    if (!listado) {   // solo la primera vez: redes que ve la placa
      listado = true;
      int n = WiFi.scanNetworks();
      Serial.printf("Redes visibles (%d):\n", n);
      for (int i = 0; i < n && i < 15; i++)
        Serial.printf("  \"%s\"  %d dBm %s\n", WiFi.SSID(i).c_str(), WiFi.RSSI(i),
                      WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "(abierta)" : "(con clave)");
      WiFi.scanDelete();
    }
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
  analogSetPinAttenuation(PIN_HUMEDAD_ANALOG, ADC_11db);   // rango completo 0-3.3 V

  // Bus I2C bloqueado (SDA o SCL pegados a GND por un cable mal puesto)? Se detecta al instante:
  // si no, el escaneo esperaria un timeout por cada direccion y la placa pareceria "muerta" varios minutos.
  pinMode(SDA_PIN, INPUT_PULLUP);
  pinMode(SCL_PIN, INPUT_PULLUP);
  delay(5);
  bool sdaOk = digitalRead(SDA_PIN) == HIGH, sclOk = digitalRead(SCL_PIN) == HIGH;

  Wire.begin(SDA_PIN, SCL_PIN, 100000);
  Wire.setTimeOut(25);   // ms: si un sensor no responde, no bloquear la placa
  if (sdaOk && sclOk) {
    escanearI2C();
  } else {
    Serial.printf("[ERROR] Bus I2C BLOQUEADO (SDA=%s, SCL=%s): un cable de los sensores esta mal puesto.\n"
                  "        Revisa VCC/GND/SDA/SCL del HDC1080 y del AP3216 (prueba desconectandolos uno a uno).\n",
                  sdaOk ? "ok" : "pegado a GND", sclOk ? "ok" : "pegado a GND");
  }
  hdc1080.begin(HDC1080_ADDR);
  if (i2cResponde(AP3216_ADDR)) {
    ap3216.init();
    ap3216.setMode(AP3216_ALS_PS);
  }

  conectarWiFi();
}

// Promedio de 10 lecturas: el ADC del ESP32 es ruidoso  
int leerSueloRaw() {
  long suma = 0;
  for (int i = 0; i < 10; i++) { suma += analogRead(PIN_HUMEDAD_ANALOG); delay(5); }
  return suma / 10;
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
    float lux      = leerLux();

    int humedadSueloRaw = leerSueloRaw();
    int humedadSueloPorcentaje = map(humedadSueloRaw, HUMEDAD_RAW_SECO, HUMEDAD_RAW_MOJADO, 0, 100);
    humedadSueloPorcentaje = constrain(humedadSueloPorcentaje, 0, 100);
    bool estaSeco = (humedadSueloPorcentaje < UMBRAL_SECO_PCT);

    Serial.println("=== MONITOREO DE PLANTA ===");
    Serial.printf("Temp / Hum Aire : %.2f C | %.2f %%\n", tempAire, humAire);
    Serial.printf("Luz Ambiental   : %.2f lux\n", lux);
    Serial.printf("Humedad Suelo   : %d %% (RAW: %d)\n", humedadSueloPorcentaje, humedadSueloRaw);
    // Diagnostico: el pin que cambia al mojar el sensor es donde esta el cable AO
    Serial.printf("  diag ADC      : VP/GPIO36=%d  VN/GPIO39=%d  (el codigo usa GPIO%d)\n",
                  analogRead(36), analogRead(39), PIN_HUMEDAD_ANALOG);
    Serial.printf("Alerta seco     : %s\n", estaSeco ? "SI" : "NO");

    enviarDatosServidor(tempAire, humAire, lux, humedadSueloPorcentaje, humedadSueloRaw, estaSeco);
    Serial.println("---------------------------\n");
  }
}