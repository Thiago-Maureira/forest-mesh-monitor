#include <ArduinoJson.h>
#include <painlessMesh.h>

// ==========================================
// 🕸️ CONFIGURACIÓN MESH
// ==========================================
#define MESH_PREFIX "RedSensores"
#define MESH_PASSWORD "sensores2025"
#define MESH_PORT 5555

// ==========================================
// 📡 CONFIGURACIÓN COMUNICACIÓN SERIAL
// ==========================================
#define SERIAL_BAUD 115200

Scheduler userScheduler;
painlessMesh mesh;

// ==========================================
// 📊 VARIABLES GLOBALES
// ==========================================
unsigned long lastHeartbeat = 0;
const unsigned long HEARTBEAT_INTERVAL = 10000; // 10 segundos

// ==========================================
// 📡 FUNCIÓN CALLBACK MESH
// ==========================================
void receivedCallback(uint32_t from, String &msg) {
// Crear documento JSON para enviar por serial
 StaticJsonDocument<512> doc;
 
 doc["type"] = "sensor_data";
 doc["timestamp"] = millis();
 
// Parsear el mensaje recibido si es JSON
 StaticJsonDocument<256> msgDoc;
 DeserializationError error = deserializeJson(msgDoc, msg);
 
 if (!error) {
// ✅ Si el mensaje es JSON válido, copiarlo como objeto (los datos quedan en doc["data"])
  doc["data"] = msgDoc;
 } else {
// ⚠️ Si no es JSON, enviarlo como string (los datos quedan en doc["data"])
  doc["data"] = msg;
 }
 
// Serializar y enviar por Serial
 serializeJson(doc, Serial);
 Serial.println(); // Nueva línea para separar mensajes
}

// ==========================================
// 📤 FUNCIÓN PARA ENVIAR ESTADO
// ==========================================
void sendStatus() {
  StaticJsonDocument<256> doc;
  
  doc["type"] = "status";
  doc["node_count"] = mesh.getNodeList().size() + 1; // +1 para incluir el maestro
  doc["mesh_id"] = mesh.getNodeId();
  doc["timestamp"] = millis();
  doc["free_heap"] = ESP.getFreeHeap();
  doc["uptime"] = millis() / 1000; // segundos
  
  serializeJson(doc, Serial);
  Serial.println();
}

// ==========================================
// 🚀 SETUP
// ==========================================
void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(1000);
  
  // Mensaje de inicio
  Serial.println("{\"type\":\"init\",\"message\":\"ESP32 Maestro Mesh iniciando\"}");
  
  // Inicialización de Mesh
  mesh.setDebugMsgTypes(ERROR | STARTUP);
  mesh.init(MESH_PREFIX, MESH_PASSWORD, &userScheduler, MESH_PORT);
  mesh.onReceive(&receivedCallback);
  
  // Enviar confirmación de inicio
  StaticJsonDocument<256> doc;
  doc["type"] = "ready";
  doc["mesh_id"] = mesh.getNodeId();
  doc["mesh_prefix"] = MESH_PREFIX;
  doc["version"] = "1.0";
  serializeJson(doc, Serial);
  Serial.println();
}

// ==========================================
// 🔁 LOOP PRINCIPAL
// ==========================================
void loop() {
  // Mantener Mesh activa
  mesh.update();
  
  // Enviar heartbeat periódico
  unsigned long currentMillis = millis();
  if (currentMillis - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    lastHeartbeat = currentMillis;
    sendStatus();
  }
  
  // Procesar comandos desde Serial (opcional)
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    
    if (command == "STATUS") {
      sendStatus();
    } 
    else if (command == "NODES") {
      auto nodes = mesh.getNodeList();
      StaticJsonDocument<512> doc;
      doc["type"] = "node_list";
      JsonArray nodeArray = doc.createNestedArray("nodes");
      for (auto node : nodes) {
        nodeArray.add(node);
      }
      serializeJson(doc, Serial);
      Serial.println();
    }
    else if (command == "PING") {
      StaticJsonDocument<128> doc;
      doc["type"] = "pong";
      doc["timestamp"] = millis();
      serializeJson(doc, Serial);
      Serial.println();
    }
  }
}