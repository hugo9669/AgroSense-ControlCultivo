# Guía Maestra de Estudio y Sustentación — Proyecto AgroSense

Documento de preparación técnica y conceptual para la defensa del proyecto ante el jurado o docente evaluador. Contiene la justificación formal de cada decisión de diseño, el marco teórico de las tecnologías implementadas y las respuestas a las preguntas de sustentación más frecuentes.

---

## 1. El "Elevator Pitch" (Cómo resumir el proyecto en 2 minutos)

> *"AgroSense es un sistema de agricultura de precisión de extremo a extremo basado en el estándar europeo **FIWARE**. Integra un dispositivo en el borde basado en un **ESP32**, que mide variables críticas como temperatura, humedad del aire, luminosidad y humedad del suelo.*  
> *Los datos ingresan a una nube en **AWS** a través de un proxy inverso seguro hacia el **IoT Agent**, gestionando el estado vivo en **Orion Context Broker**. Para resolver el desafío de persistencia histórica, usamos **QuantumLeap y CrateDB** como almacenamiento en frío de series de tiempo crudas.*  
> *Sobre esos datos, diseñamos un **ETL en Python** con rigor estadístico: aplica detección de anomalías usando la **Desviación Absoluta respecto a la Mediana (MAD)** y realiza una **imputación e interpolación lineal controlada para micro-cortes menores a 2 minutos**, manteniendo siempre la trazabilidad con banderas booleanas para no falsear auditorías.*  
> *Los datos limpios alimentan un **Data Warehouse en PostgreSQL**, que a su vez nutre una **API en FastAPI** asistida por un modelo de lenguaje de última generación (**Google Gemini**) para generar diagnósticos agronómicos en tiempo real, un **panel web reactivo en React** y tableros estadísticos en **Grafana**."*

---

## 2. Justificación Técnica de Decisiones de Diseño

En una sustentación de ingeniería de software e IoT, los evaluadores evalúan **por qué** se tomó cada decisión técnica frente a las alternativas.

### A. ¿Por qué se utilizó el ecosistema FIWARE (NGSI v2)?
* **Alternativa común:** Usar un broker MQTT plano (como Mosquitto) y guardar JSON directamente en una base de datos relacional.
* **Justificación técnica:**  
  FIWARE es el estándar de facto de la Unión Europea para Smart Cities y Smart Agrifood. Proporciona una arquitectura desacoplada orientada a **Gestión de Contexto**:
  1. **Modelo de Información Estándar:** Modela el cultivo como una entidad digital (`planta01` de tipo `PlantSensor`) con atributos tipados (`DateTime`, `Number`, `Text`).
  2. **Mecanismo Publish/Subscribe:** Orion permite que cualquier subsistema (como QuantumLeap para históricos o actuadores de riego) se suscriba a cambios de estado sin necesidad de que el microcontrolador conozca quién consume la información.
  3. **Interoperabilidad:** Cumple con la especificación NGSIv2 / NGSI-LD, permitiendo integrar en el futuro sistemas de terceros o plataformas de agricultura abierta sin reescribir el firmware.

---

### B. ¿Por qué se usaron dos bases de datos: CrateDB (Crudo) y PostgreSQL (DWH)?
* **Alternativa común:** Usar una sola base de datos (por ejemplo, guardar todo en PostgreSQL o todo en MongoDB).
* **Justificación técnica (Arquitectura Medallion / Separación Bronze vs Gold):**
  1. **CrateDB (Capa Cruda / Cold Storage):** Es un motor distribuido masivo optimizado para series de tiempo e inserciones concurrentes de alta frecuencia (`append-only`). Aquí se guardan los datos tal y como salieron del cable, sin alterar una sola coma. Si el sensor envía `-999`, en CrateDB queda registrado `-999` para auditoría forense del hardware.
  2. **PostgreSQL (Data Warehouse / Capa Analítica):** Las aplicaciones de usuario (dashboards, reportes, consultas de agregación y el modelo de IA) no deben consultar series de tiempo crudas con ruido o datos atípicos. PostgreSQL ofrece integridad ACID, transacciones seguras y optimización relacional con índices para calcular medias, mínimos, máximos y percentiles exactos sobre datos previamente saneados por el ETL.

---

### C. ¿Por qué usar MAD (Median Absolute Deviation) en vez de Desviación Estándar para Atípicos?
* **Alternativa común:** Regla de las tres desviaciones estándar ($\mu \pm 3\sigma$).
* **Justificación matemática:**  
  La media ($\mu$) y la desviación estándar ($\sigma$) **no son estimadores robustos**. Su punto de quiebre (breakdown point) es de $0\%$: basta una sola lectura corrupta extrema (por ejemplo, que el sensor marque $4095^\circ\text{C}$ o $-999^\circ\text{C}$ por ruido eléctrico) para inflar artificialmente la media y disparar la desviación estándar, haciendo que las lecturas reales siguientes queden erróneamente clasificadas o que el atípico pase desapercibido.
* **La solución implementada:**  
  La **Mediana** y el **MAD (Desviación Absoluta respecto a la Mediana)** tienen un punto de quiebre del **$50\%$**, lo que significa que hasta la mitad de las muestras de la ventana pueden ser basura y el estimador seguirá identificando el centro real de los datos sin sesgo.
  $$\text{MAD} = \text{mediana}\Big(|x_i - \text{mediana}(X)|\Big)$$
  Se complementa con un $\Delta_{\min}$ ($6^\circ\text{C}$ en temperatura) para no catalogar como atípico un cambio natural cuando la varianza del cultivo es extremadamente baja.

---

### D. ¿Por qué Imputación / Interpolación Lineal Controlada ($\le 2$ min) y no Extrapolación?
* **Alternativa 1 (No hacer nada):** Dejar huecos vacíos (`NULL`) rompe la continuidad visual de las gráficas temporales y causa errores en modelos analíticos.
* **Alternativa 2 (Extrapolar siempre hacia adelante):** Si el sensor se desconecta por 30 minutos y el sistema sigue proyectando "temperatura estable a $25^\circ\text{C}$", se oculta una emergencia real (una helada o un incendio).
* **Justificación de la solución adoptada:**
  1. **Inercia física:** La temperatura del aire y la humedad del suelo presentan **alta autocorrelación temporal**. En intervalos cortos ($\le 120$ s / 1 a 2 muestras de 30 s), la aproximación lineal entre el vecino anterior $(t_{prev}, v_{prev})$ y el posterior $(t_{next}, v_{next})$ tiene un error residual mínimo.
  2. **Límite de seguridad:** Si el lapso supera los 2 minutos, el ETL se rehúsa a estimar y deja el valor en `NULL`, disparando la alarma de desconexión.
  3. **Trazabilidad (Linaje del dato):** En la base de datos se almacena la columna `es_imputado = TRUE`. El sistema no "maquilla" datos en secreto; sabe exactamente cuáles fueron medidos por el silicio y cuáles estimados por el algoritmo.

---

### E. ¿Por qué Nginx en el puerto 80 como Proxy Inverso Unificado?
* **Alternativa común:** Exponer directamente el puerto del frontend (5173/80), el de FastAPI (8000), el del IoT Agent (7896) y el de Orion (1026).
* **Justificación técnica:**
  1. **Superación de problemas de CORS (Cross-Origin Resource Sharing):** Al salir todo por el mismo dominio/IP y puerto 80, el navegador web accede a la API bajo `/api/*` sin bloqueos de origen cruzado.
  2. **Seguridad perimetral (Attack Surface Reduction):** El IoT Agent corre internamente en el puerto 7896. Si estuviera abierto a Internet, cualquier atacante podría inyectar paquetes falsificados directamente. Nginx recibe en `/iot/json` y valida el tráfico antes de transferirlo internamente.
  3. **Facilidad en entornos institucionales/académicos:** Muchas redes universitarias o corporativas bloquean puertos no estándar (como 7896, 8000 o 1026). El puerto 80 es universalmente accesible.

---

### F. ¿Por qué la placa envía por HTTP y no por LoRaWAN en esta etapa?
* **Hardware utilizado:** La placa elegida es una **LilyGO TTGO T-Beam**, la cual incluye un transceptor de radio LoRa (Semtech SX1276) y un chip Wi-Fi/Bluetooth ESP32.
* **Justificación de ingeniería:**
  * En esta primera fase del proyecto, el objetivo principal fue validar la pila completa de ingesta FIWARE, el modelo analítico del DWH, la limpieza con MAD y el asistente de Inteligencia Artificial. La conectividad Wi-Fi mediante HTTP REST permite enviar payloads ricos en formato JSON a alta frecuencia (cada 30 s) sin restricciones de *Duty Cycle* (como el límite legal del 1% de tiempo de transmisión en LoRa 915 MHz).
  * La arquitectura quedó diseñada de forma modular: en una segunda fase, la T-Beam puede compilarse con LoRaWAN hacia un Gateway TTN (The Things Network) y desde allí hacer un puente hacia el mismo IoT Agent de FIWARE sin alterar una sola línea del backend ni del ETL.

---

### G. ¿Por qué Google Gemini con la API de Interacciones contextualizada?
* **Alternativa común:** Un chatbot genérico sin conexión a la base de datos o reglas duras de `if/else`.
* **Justificación técnica:**
  * Las reglas de umbrales fijos (`if temp > 35 alert()`) detectan violaciones obvias, pero no comprenden **patrones agronómicos complejos** (por ejemplo: *"la temperatura está en rango aceptable, pero la humedad relativa cayó un 40% en 2 horas y la humedad del suelo está en descenso continuo: riesgo de deshidratación acelerada"*).
  * **Inyección de contexto en dos niveles:** En lugar de enviarle al LLM miles de filas de telemetría cruda (lo que agotaría la ventana de tokens y aumentaría la latencia), la API consulta los **resúmenes precalculados del DWH** (promedios de 24h, tendencias de 7 días y alertas activas) y se los inyecta en el prompt del sistema.
  * **Resiliencia con modelo de respaldo:** El sistema cuenta con fallback automático (`gemini-3.8-flash` $\rightarrow$ `gemini-3.5-flash-lite`) para mitigar errores de cuota (HTTP 429) o saturación de la nube.

---

## 3. Preguntas Típicas de Sustentación ("Preguntas Trampa") y Cómo Responderlas

### P1: *"¿Qué pasa si se cae el Wi-Fi o se apaga la placa durante 1 hora?"*
* **Respuesta:**  
  *"El sistema tiene tres capas de protección ante este fallo:  
  1. En el microcontrolador, la función `conectarWiFi()` detecta la pérdida de señal y entra en un modo de reconexión automática sin reiniciar el CPU.  
  2. En el ETL, la función `check_sin_datos()` monitorea el `max(ts)` de cada planta. Al pasar 15 minutos sin recibir telemetría, genera automáticamente una alerta de severidad `error`: 'Sensor sin datos: revisar energía o Wi-Fi', la cual se envía a Orion y se muestra en el panel.  
  3. En la base de datos, el algoritmo de imputación detecta que la brecha temporal supera los 2 minutos ($\Delta t > 120$ s). Por tanto, **se abstiene de inventar datos**, preservando la integridad de los históricos y dejando constancia del corte."*

---

### P2: *"¿Por qué la humedad del suelo arrojaba un valor RAW de 4095 al inicio y cómo se soluciona?"*
* **Respuesta:**  
  *"El conversor ADC del ESP32 tiene una resolución de 12 bits ($2^{12} = 4096$ niveles, de 0 a 4095). Los sensores higrómetros resistivos operan con lógica inversa: en el aire seco la resistencia entre electrodos es infinita y el circuito entrega la máxima tensión de referencia ($3.3\text{V} \rightarrow \text{RAW } 4095$). Al sumergirlo en agua o suelo saturado, la conductividad aumenta y la tensión cae (típicamente a $\approx 2300$).  
  En el firmware implementamos una calibración de dos puntos:  
  `map(raw, HUMEDAD_RAW_SECO, HUMEDAD_RAW_MOJADO, 0, 100);`  
  Para asegurar que la lectura represente el 0% en suelo seco y el 100% en saturación."*

---

### P3: *"Si dos lecturas llegan al mismo tiempo o se procesa un lote dos veces, ¿se duplican los datos en el Data Warehouse?"*
* **Respuesta:**  
  *"No, la arquitectura es completamente **idempotente**:  
  1. La tabla `lectura_limpia` tiene una clave primaria compuesta `(entity_id, ts)`. La inserción utiliza la cláusula `ON CONFLICT (entity_id, ts) DO UPDATE`, lo que actualiza los valores existentes en lugar de duplicar filas.  
  2. La tabla de alertas implementa una regla de deduplicación que verifica si ya existe una alerta activa del mismo tipo para esa planta en los últimos 30 minutos antes de crear una nueva.  
  3. Los rollups horarios y diarios se truncan por fecha (`date_trunc('hour', ts)`) y usan `ON CONFLICT (entity_id, hora) DO UPDATE`, de modo que recalcular un lote produce exactamente el mismo estado final en la base de datos."*

---

### P4: *"¿Por qué no usaron Terraform para crear la infraestructura en AWS?"*
* **Respuesta:**  
  *"Terraform es una herramienta de Infraestructura como Código (IaC) muy potente para crear y destruir flotas de máquinas repetibles. Sin embargo, para este proyecto contábamos con una instancia existente en el laboratorio de AWS Academy. Usar Terraform habría requerido recrear la máquina desde cero cada vez, con el riesgo de agotar el crédito del laboratorio por reaprovisionamiento.  
  En su lugar, resolvimos la persistencia de dos formas eficientes:  
  1. Asignamos una **IP Elástica** fija (`32.193.138.160`) desde la consola para que la dirección pública no varíe ante detenciones de la máquina.  
  2. Implementamos un pipeline de despliegue automatizado en PowerShell (`deploy/desplegar.ps1`) que empaqueta únicamente el código limpio con `git archive` y aprovisiona el servidor por SSH/SCP en menos de 30 segundos."*

---

## 4. Checklist para una Demostración en Vivo Exitosa (Live Demo)

1. **Mostrar la placa física y terminal serie:**
   * Abrir el Serial Monitor de PlatformIO (115200 baud).
   * Presionar el botón `RST` del T-Beam: señalar el escaneo I2C donde reconoce el HDC1080 (`0x40`) y el AP3216 (`0x1E`).
   * Mostrar el envío del JSON con código `HTTP 200`.
2. **Mostrar el Panel Web AgroSense (`http://32.193.138.160`):**
   * Iniciar sesión con `admin` / `admin123`.
   * En la pestaña **Resumen**, mostrar el Gauge del Índice de Salud y las 4 tarjetas de sensores.
   * Tapar el sensor AP3216 con la mano para mostrar cómo la luminosidad cae a $< 100\text{ lux}$ y se refleja en el panel en la siguiente lectura.
   * Abrir el **Chat con la IA** y preguntar: *"¿Cuál es el estado de la planta hoy y qué recomendaciones me das?"*. Mostrar cómo la respuesta hace referencia a los datos reales y alertas del cultivo.
3. **Mostrar Grafana (`http://32.193.138.160:3000`):**
   * Abrir el tablero **AgroIoT - Estado de la planta (estadísticas)**.
   * Mostrar la tabla de estadística descriptiva (media, desviación estándar, percentil 95) y la matriz de correlación de Pearson.
4. **Demostrar el DWH y la Imputación (Terminal/PostgreSQL):**
   * Mostrar que la tabla `lectura_limpia` contiene la columna `es_imputado` que certifica la trazabilidad del proceso analítico.
