#include "painlessMesh.h"
#include <ArduinoJson.h>
// ============================================
// CONFIGURACIÓN DE RED MESH
// ============================================
#define MESH_PREFIX     "SmartHomeMesh"
#define MESH_PASSWORD   "MeshPass123"
#define MESH_PORT       5555

// ============================================
// CONFIGURACIÓN DE SENSORES
// ============================================
// Rangos de valores simulados
#define TEMP_MIN        20.0    // °C
#define TEMP_MAX        30.0    // °C
#define HUM_MIN         40      // %
#define HUM_MAX         70      // %
#define LUZ_MIN         100     // lux
#define LUZ_MAX         1000    // lux
#define PRES_MIN        1000.0  // hPa
#define PRES_MAX        1020.0  // hPa

// Intervalo de envío de datos (milisegundos)
#define SEND_INTERVAL   5000    // 5 segundos

// ============================================
// OBJETOS PRINCIPALES
// ============================================
Scheduler userScheduler;
painlessMesh mesh;

// ============================================
// VARIABLES GLOBALES
// ============================================
uint32_t myNodeId = 0;          // ID de este nodo
uint32_t rootNodeId = 0;        // ID del nodo maestro (Root)
unsigned long lastSendTime = 0; // Control de tiempo de envío

// ============================================
// PROTOTIPOS DE FUNCIONES
// ============================================
void setupMesh();
void sendSensorData();
float simulateTemperature();
int simulateHumidity();
int simulateLightLevel();
float simulatePressure();
String createSensorJSON();
void receivedCallback(uint32_t from, String &msg);
void newConnectionCallback(uint32_t nodeId);
void changedConnectionCallback();
void nodeTimeAdjustedCallback(int32_t offset);

// ============================================
// SETUP
// ============================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  // Inicializar generador de números aleatorios
  randomSeed(analogRead(0));
  
  Serial.println("\n╔═══════════════════════════════════════╗");
  Serial.println("║  ESP32 NODO ESCLAVO - Sensor Node    ║");
  Serial.println("╚═══════════════════════════════════════╝\n");
  
  // Configurar red Mesh
  setupMesh();
  
  Serial.println("✅ Nodo esclavo iniciado correctamente");
  Serial.println("📡 Enviando datos cada 5 segundos...\n");
}

// ============================================
// LOOP PRINCIPAL
// ============================================
void loop() {
  // Actualizar mesh
  mesh.update();
  
  // Enviar datos cada 5 segundos
  unsigned long currentTime = millis();
  if (currentTime - lastSendTime >= SEND_INTERVAL) {
    sendSensorData();
    lastSendTime = currentTime;
  }
}

// ============================================
// CONFIGURACIÓN DE MESH
// ============================================
void setupMesh() {
  Serial.println("🔷 Configurando red Mesh...");
  Serial.print("   Mesh SSID: ");
  Serial.println(MESH_PREFIX);
  Serial.print("   Puerto: ");
  Serial.println(MESH_PORT);
  
  // Configurar solo mensajes de error
  mesh.setDebugMsgTypes(ERROR);
  
  // Inicializar mesh
  mesh.init(MESH_PREFIX, MESH_PASSWORD, &userScheduler, MESH_PORT);
  
  // Configurar callbacks
  mesh.onReceive(&receivedCallback);
  mesh.onNewConnection(&newConnectionCallback);
  mesh.onChangedConnections(&changedConnectionCallback);
  mesh.onNodeTimeAdjusted(&nodeTimeAdjustedCallback);
  
  // Obtener ID de este nodo
  myNodeId = mesh.getNodeId();
  
  Serial.println("✅ Mesh configurada");
  Serial.print("   Mi Node ID: ");
  Serial.println(myNodeId);
  Serial.println();
}

// ============================================
// FUNCIONES DE SIMULACIÓN DE SENSORES
// ============================================

// Simular lectura de temperatura (20.0 - 30.0 °C)
float simulateTemperature() {
  float temp = TEMP_MIN + (random(0, 1000) / 1000.0) * (TEMP_MAX - TEMP_MIN);
  return temp;
}

// Simular lectura de humedad (40 - 70 %)
int simulateHumidity() {
  int hum = random(HUM_MIN, HUM_MAX + 1);
  return hum;
}

// Simular lectura de luz ambiental (100 - 1000 lux)
int simulateLightLevel() {
  int luz = random(LUZ_MIN, LUZ_MAX + 1);
  return luz;
}

// Simular lectura de presión atmosférica (1000.0 - 1020.0 hPa)
float simulatePressure() {
  float pres = PRES_MIN + (random(0, 1000) / 1000.0) * (PRES_MAX - PRES_MIN);
  return pres;
}

// ============================================
// CREACIÓN DE MENSAJE JSON
// ============================================
String createSensorJSON() {
  // Simular lecturas de sensores
  float temperatura = simulateTemperature();
  int humedad = simulateHumidity();
  int luz = simulateLightLevel();
  float presion = simulatePressure();
  
  // Crear documento JSON
  JsonDocument doc;
  
  // Agregar ID del nodo
  doc["id"] = myNodeId;
  
  // Agregar datos de sensores
  doc["temperatura"] = round(temperatura * 10) / 10.0; // 1 decimal
  doc["humedad"] = humedad;
  doc["luz"] = luz;
  doc["presion"] = round(presion * 10) / 10.0; // 1 decimal
  
  // Serializar a String
  String jsonString;
  serializeJson(doc, jsonString);
  
  return jsonString;
}

// ============================================
// ENVÍO DE DATOS AL MAESTRO
// ============================================
void sendSensorData() {
  // Crear mensaje JSON con datos de sensores
  String jsonData = createSensorJSON();
  
  // Intentar enviar al nodo raíz (maestro)
  if (rootNodeId != 0) {
    // Enviar a maestro específico
    mesh.sendSingle(rootNodeId, jsonData);
    Serial.println("📤 Datos enviados al maestro:");
  } else {
    // Si no hay maestro conocido, enviar broadcast
    mesh.sendBroadcast(jsonData);
    Serial.println("📤 Datos enviados (broadcast):");
  }
  
  // Mostrar datos enviados
  Serial.println(jsonData);
  Serial.println();
}

// ============================================
// CALLBACKS DE MESH
// ============================================

// Callback: Mensaje recibido
void receivedCallback(uint32_t from, String &msg) {
  Serial.print("📨 Mensaje de Node ");
  Serial.print(from);
  Serial.print(": ");
  Serial.println(msg);
  
  // Si es el primer mensaje, asumir que es del maestro
  if (rootNodeId == 0) {
    rootNodeId = from;
    Serial.print("🎯 Maestro detectado: ");
    Serial.println(rootNodeId);
  }
}

// Callback: Nueva conexión
void newConnectionCallback(uint32_t nodeId) {
  Serial.print("✅ Conectado a Node: ");
  Serial.println(nodeId);
  
  // Asumir que el primer nodo conectado es el maestro
  if (rootNodeId == 0) {
    rootNodeId = nodeId;
    Serial.print("🎯 Maestro establecido: ");
    Serial.println(rootNodeId);
  }
}

// Callback: Cambio en conexiones
void changedConnectionCallback() {
  // Obtener lista de nodos conectados
  auto nodes = mesh.getNodeList();
  
  Serial.print("🔄 Nodos conectados: ");
  Serial.println(nodes.size());
  
  // Verificar si el maestro sigue conectado
  if (rootNodeId != 0) {
    bool masterFound = false;
    for (auto node : nodes) {
      if (node == rootNodeId) {
        masterFound = true;
        break;
      }
    }
    
    // Si el maestro se desconectó, buscar nuevo maestro
    if (!masterFound) {
      Serial.println("⚠️ Maestro desconectado");
      
      if (nodes.size() > 0) {
        rootNodeId = nodes.front();
        Serial.print("🎯 Nuevo maestro: ");
        Serial.println(rootNodeId);
      } else {
        rootNodeId = 0;
        Serial.println("⚠️ Sin nodos disponibles");
      }
    }
  } else if (nodes.size() > 0) {
    // Si no hay maestro pero hay nodos, seleccionar el primero
    rootNodeId = nodes.front();
    Serial.print("🎯 Maestro establecido: ");
    Serial.println(rootNodeId);
  }
}

// Callback: Ajuste de tiempo (silencioso)
void nodeTimeAdjustedCallback(int32_t offset) {
  // No mostrar nada para mantener serial limpio
}