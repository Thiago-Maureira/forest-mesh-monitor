#include <painlessMesh.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_BMP085.h>
#include <ESP32Servo.h>

// ==========================================
// CONFIGURACIÓN MESH
// ==========================================
#define MESH_PREFIX "RedSensores"
#define MESH_PASSWORD "sensores2025"
#define MESH_PORT 5555

Scheduler userScheduler;
painlessMesh mesh;

#define NODE_ID "ESP32_esclavo_01"
unsigned long lastSend = 0;
const long SEND_INTERVAL = 5000; // 5 segundos

// ==========================================
// PINES DE SENSORES Y ACTUADOR
// ==========================================
#define MQ2_PIN 32      // DOUT del MQ-2 (modo digital)
#define DHT_PIN 14     
#define FLAME_PIN 25
#define I2C_SDA 21
#define I2C_SCL 22
#define RAIN_PIN 35     // Pin Analógico para Sensor de Lluvia
#define SERVO_PIN 15    // Pin para el Motor Servo

// ==========================================
// CONFIGURACIÓN SENSOR DE LLUVIA
// ==========================================
const int LIMITE_LLUVIA = 2900; // Umbral: > 2900 = lloviendo (seco)

// ==========================================
// CONSTANTE DE FILTRO (AGREGADA)
// ==========================================
#define ALPHA 0.3  // Factor de suavizado: 0.0 = sin cambio, 1.0 = cambio total

// ==========================================
// SENSORES
// ==========================================
#define DHT_TYPE DHT11
DHT dht(DHT_PIN, DHT_TYPE);
Adafruit_BMP085 bmp;

// ==========================================
// VARIABLES GLOBALES DE SENSORES Y FILTROS
// ==========================================
bool bmpOK = false;
bool dhtOK = false;

float tempFiltrada = 25.0;
float humFiltrada = 50.0;

// ==========================================
// VARIABLES GLOBALES DE SERVO Y TIMER
// ==========================================
Servo miServo;

// Valores de control para dirección 1 (original)
#define VELOCIDAD_1_DIR1 92
#define VELOCIDAD_2_DIR1 99

// Valores de control para dirección 2 (opuesta)
#define VELOCIDAD_1_DIR2 94  
#define VELOCIDAD_2_DIR2 87  

#define DETENER 93
#define TIEMPO_GIRO_MS 300
#define TIEMPO_PAUSA_MS 3000
#define CICLOS_POR_DIRECCION 7  // 7 giros completos por dirección

// Estados del proceso del servo
enum Estado {
  GIRANDO_VEL1,
  GIRANDO_VEL2,
  DETENIDO,
  RETORNANDO_VEL1,
  RETORNANDO_VEL2,
  PAUSA_RETORNO
};

volatile Estado estadoActual = GIRANDO_VEL1;
volatile unsigned long tiempoInicio = 0;
volatile bool cambiarEstado = false;
volatile int contadorCiclos = 0;
volatile bool direccion1 = true;  // true = dirección 1, false = dirección 2

// Variables para el timer
hw_timer_t *timer = NULL;
portMUX_TYPE timerMux = portMUX_INITIALIZER_UNLOCKED;

// ==========================================
// DECLARACIÓN DE FUNCIONES
// ==========================================
void inicializarSensores();
void leerYEnviarDatos();
void receivedCallback(uint32_t from, String &msg);
void IRAM_ATTR onTimer(); // Declaración del ISR

// ==========================================
// CALLBACK MESH
// ==========================================
void receivedCallback(uint32_t from, String &msg) {
  Serial.printf("Recibido de %u: %s\n", from, msg.c_str());
}

// ==========================================
// INICIALIZAR SENSORES
// ==========================================
void inicializarSensores() {
  Serial.println("Inicializando sensores...");

  // I2C (BMP180)
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(100000);
  delay(100);

  bmpOK = bmp.begin();
  if (bmpOK) Serial.println("BMP180: OK");
  else Serial.println("BMP180: No detectado (continuando sin presión)");

  // DHT
  dht.begin();
  delay(1500);
  float testTemp = dht.readTemperature();
  dhtOK = !isnan(testTemp);
  Serial.print("DHT11 (Pin 14): ");
  Serial.println(dhtOK ? "OK" : "Error");

  Serial.println("Otros sensores listos.\n");
}

// ==========================================
// LECTURA Y ENVÍO DE DATOS
// ==========================================
void leerYEnviarDatos() {
  float temp = 25.0;
  float hum = 50.0;

  // ----- DHT -----
  if (dhtOK) {
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t) && t > -10 && t < 60) tempFiltrada = ALPHA * t + (1 - ALPHA) * tempFiltrada;
    if (!isnan(h) && h >= 0 && h <= 100) humFiltrada = ALPHA * h + (1 - ALPHA) * humFiltrada;
    temp = tempFiltrada;
    hum = humFiltrada;
  }

  // ----- MQ-2 (digital) -----
  int gasDetectado = (digitalRead(MQ2_PIN) == LOW) ? 1 : 0; // LOW = gas detectado
  String estadoGas = gasDetectado ? "Gas detectado" : "Aire limpio";

  // ----- Fuego -----
  int fuego = (digitalRead(FLAME_PIN) == LOW) ? 1 : 0; // LOW = Fuego detectado

  // ----- Presión -----
  float presion = 101325;
  if (bmpOK) {
    float p = bmp.readPressure();
    if (!isnan(p) && p > 90000 && p < 110000) presion = p;
  }

  // ----- Sensor de lluvia (Rain Drop Sensor) -----
  int valorLluvia = analogRead(RAIN_PIN);
  valorLluvia = constrain(valorLluvia, 0, 4095);
  // El valor alto (cerca de 4095) es cuando NO hay agua (SECO)
  // El valor bajo (cerca de 0) es cuando SÍ hay agua (LLOVIENDO)
  String estadoLluvia = (valorLluvia < LIMITE_LLUVIA) ? "SECO" : "LLOVIENDO";

  // ----- Crear JSON -----
  StaticJsonDocument<256> doc;
  doc["node"] = NODE_ID;
  doc["T"] = round(temp * 10) / 10.0;
  doc["H"] = round(hum * 10) / 10.0;
  doc["Gas"] = gasDetectado;
  doc["GasEstado"] = estadoGas;
  doc["Fuego"] = fuego;
  doc["Presion"] = presion;
  doc["Lluvia"] = estadoLluvia; // Estado de la Lluvia
  doc["ValorLluvia"] = valorLluvia;

  char buffer[256];
  size_t jsonLen = serializeJson(doc, buffer);

  mesh.sendBroadcast(buffer);

  // ----- Monitor Serial -----
  Serial.printf("T:%.1f°C | H:%.1f%% | Gas:%s | Fuego:%s | P:%.0fPa | Lluvia:%s (ADC:%d)\n",
                 temp, hum, estadoGas.c_str(), fuego ? "SI" : "NO", presion,
                 estadoLluvia.c_str(), valorLluvia);
  Serial.printf("JSON (%d bytes) enviado por Mesh.\n", jsonLen);
  Serial.println("---");
}

// ==========================================
// ISR DEL TIMER PARA CONTROL DE SERVO
// ==========================================
// Función de interrupción del timer (se ejecuta cada 1ms)
void IRAM_ATTR onTimer() {
  portENTER_CRITICAL_ISR(&timerMux);
  
  unsigned long tiempoTranscurrido = millis() - tiempoInicio;
  
  // El estado actual es el que está a punto de terminar.
  switch(estadoActual) {
    case GIRANDO_VEL1:
      if (tiempoTranscurrido >= TIEMPO_GIRO_MS) {
        estadoActual = GIRANDO_VEL2;
        tiempoInicio = millis();
        cambiarEstado = true;
      }
      break;
      
    case GIRANDO_VEL2:
      if (tiempoTranscurrido >= TIEMPO_GIRO_MS) {
        estadoActual = DETENIDO;
        tiempoInicio = millis();
        cambiarEstado = true;
        contadorCiclos++;  // Incrementar contador al completar un ciclo
      }
      break;
      
    case DETENIDO:
      if (tiempoTranscurrido >= TIEMPO_PAUSA_MS) {
        // Verificar si completó los ciclos en la dirección actual
        if (contadorCiclos >= CICLOS_POR_DIRECCION) {
          contadorCiclos = 0;
          direccion1 = !direccion1;  // CAMBIO DE DIRECCIÓN
          estadoActual = GIRANDO_VEL1;  // Iniciar nuevo set de ciclos
        } else {
          estadoActual = GIRANDO_VEL1;  // Continuar en la misma dirección
        }
        tiempoInicio = millis();
        cambiarEstado = true;
      }
      break;

    default:
      break;
  }
  
  portEXIT_CRITICAL_ISR(&timerMux);
}


// ==========================================
// SETUP
// ==========================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== ESP32 Esclavo Mesh ===");

  // --- 1. Configuración de pines de Sensores ---
  pinMode(FLAME_PIN, INPUT_PULLUP);
  pinMode(MQ2_PIN, INPUT);
  pinMode(RAIN_PIN, INPUT);

  // --- 2. Inicialización de Sensores ---
  inicializarSensores();

  // --- 3. Configuración del Servo y Timer ---
  miServo.attach(SERVO_PIN);
  
  // Configurar timer (cada 1ms = 1000 microsegundos)
  timer = timerBegin(0, 80, true);
  timerAttachInterrupt(timer, &onTimer, true);
  timerAlarmWrite(timer, 1000, true); // Interrupción cada 1000 microsegundos (1ms)
  timerAlarmEnable(timer);
  
  // Inicializar estado del servo
  tiempoInicio = millis();
  estadoActual = GIRANDO_VEL1;
  contadorCiclos = 0;
  direccion1 = true;
  miServo.write(VELOCIDAD_1_DIR1); // Iniciar movimiento
  Serial.printf("Servo inicializado en Pin %d\n", SERVO_PIN);
  
  // --- 4. Inicialización de Mesh ---
  mesh.setDebugMsgTypes(ERROR | STARTUP | CONNECTION);
  mesh.init(MESH_PREFIX, MESH_PASSWORD, &userScheduler, MESH_PORT);
  mesh.onReceive(&receivedCallback);

  Serial.println("Mesh iniciada. Sistema listo.\n");
}

// ==========================================
// LOOP
// ==========================================
void loop() {
  // Mantener la red Mesh activa
  mesh.update();

  // --- Lógica de envío de datos de sensores (Mesh) ---
  unsigned long currentMillis = millis();
  if (currentMillis - lastSend >= SEND_INTERVAL) {
    lastSend = currentMillis;
    leerYEnviarDatos();
  }

  // --- Lógica de control del Servo (basada en el timer ISR) ---
  if (cambiarEstado) {
    portENTER_CRITICAL(&timerMux);
    cambiarEstado = false;
    Estado estadoLocal = estadoActual;
    bool direccionLocal = direccion1;
    portEXIT_CRITICAL(&timerMux);
    
    // Ejecutar acción según el nuevo estado (fuera del ISR)
    switch(estadoLocal) {
      case GIRANDO_VEL1:
        miServo.write(direccionLocal ? VELOCIDAD_1_DIR1 : VELOCIDAD_1_DIR2);
        Serial.printf("Servo: Girando Vel 1 (Dir %d)\n", direccionLocal ? 1 : 2);
        break;
        
      case GIRANDO_VEL2:
        miServo.write(direccionLocal ? VELOCIDAD_2_DIR1 : VELOCIDAD_2_DIR2);
        Serial.printf("Servo: Girando Vel 2 (Dir %d)\n", direccionLocal ? 1 : 2);
        break;
        
      case DETENIDO:
        miServo.write(DETENER);
        Serial.printf("Servo: DETENIDO. Ciclo %d/%d\n", contadorCiclos, CICLOS_POR_DIRECCION);
        break;
        
      case RETORNANDO_VEL1:
      case RETORNANDO_VEL2:
      case PAUSA_RETORNO:
        miServo.write(DETENER);
        Serial.println("Servo DETENIDO");
        break;
    }
  }
  
  delay(10); // Pequeño delay para estabilidad.
}