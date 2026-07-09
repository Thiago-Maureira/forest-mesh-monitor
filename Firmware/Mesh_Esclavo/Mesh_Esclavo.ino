#include "painlessMesh.h"

// Configuración de la Mesh
#define   MESH_PREFIX     "miRedMesh"
#define   MESH_PASSWORD   "meshpassword123"
#define   MESH_PORT       5555

// LED integrado para indicaciones visuales
#define LED_BUILTIN 2

Scheduler userScheduler;
painlessMesh mesh;

// Variables globales
String serialBuffer = "";
uint32_t masterNodeId = 0;  // ID del nodo maestro (se detecta automáticamente)
bool meshConnected = false;

// Prototipos de funciones
void receivedCallback(uint32_t from, String &msg);
void newConnectionCallback(uint32_t nodeId);
void changedConnectionCallback();
void nodeTimeAdjustedCallback(int32_t offset);
void processSerialCommand(String command);
void blinkLED(int times, int delayMs);

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);
  
  Serial.println("\n\n=================================");
  Serial.println("ESP32 ESCLAVO - PainlessMesh");
  Serial.println("=================================\n");
  
  // Configurar mesh
  mesh.setDebugMsgTypes(ERROR | STARTUP | CONNECTION);
  
  mesh.init(MESH_PREFIX, MESH_PASSWORD, &userScheduler, MESH_PORT);
  mesh.onReceive(&receivedCallback);
  mesh.onNewConnection(&newConnectionCallback);
  mesh.onChangedConnections(&changedConnectionCallback);
  mesh.onNodeTimeAdjusted(&nodeTimeAdjustedCallback);
  
  Serial.println("✅ Mesh inicializada");
  Serial.print("🆔 Mi Node ID: ");
  Serial.println(mesh.getNodeId());
  Serial.println("\n📋 COMANDOS DISPONIBLES:");
  Serial.println("   send:<mensaje>          - Enviar mensaje al maestro");
  Serial.println("   broadcast:<mensaje>     - Enviar a todos los nodos");
  Serial.println("   status                  - Ver estado de la mesh");
  Serial.println("   nodes                   - Listar nodos conectados");
  Serial.println("   master:<nodeId>         - Establecer nodo maestro");
  Serial.println("   led:<on/off>            - Controlar LED");
  Serial.println("   help                    - Mostrar esta ayuda");
  Serial.println("=================================\n");
  
  blinkLED(3, 200);  // Indicar inicio exitoso
}

void loop() {
  mesh.update();
  
  // Leer comandos del Serial
  while (Serial.available()) {
    char c = Serial.read();
    
    if (c == '\n' || c == '\r') {
      if (serialBuffer.length() > 0) {
        processSerialCommand(serialBuffer);
        serialBuffer = "";
      }
    } else {
      serialBuffer += c;
    }
  }
}

// Callback: Mensaje recibido
void receivedCallback(uint32_t from, String &msg) {
  Serial.println("\n📨 MENSAJE RECIBIDO");
  Serial.print("   De: ");
  Serial.println(from);
  Serial.print("   Contenido: ");
  Serial.println(msg);
  
  // Si es el primer mensaje y no hay maestro, asumir que es el maestro
  if (masterNodeId == 0) {
    masterNodeId = from;
    Serial.print("🎯 Maestro detectado: ");
    Serial.println(masterNodeId);
  }
  
  // Procesar comandos especiales del maestro
  if (msg.startsWith("CMD:")) {
    String command = msg.substring(4);
    Serial.print("⚙️ Ejecutando comando: ");
    Serial.println(command);
    
    if (command == "LED_ON") {
      digitalWrite(LED_BUILTIN, HIGH);
      mesh.sendSingle(from, "LED encendido");
      Serial.println("💡 LED encendido");
    } 
    else if (command == "LED_OFF") {
      digitalWrite(LED_BUILTIN, LOW);
      mesh.sendSingle(from, "LED apagado");
      Serial.println("💡 LED apagado");
    }
    else if (command == "STATUS") {
      String status = "Node:" + String(mesh.getNodeId()) + 
                     ",Conectados:" + String(mesh.getNodeList().size());
      mesh.sendSingle(from, status);
      Serial.println("📊 Status enviado");
    }
    else if (command == "BLINK") {
      blinkLED(5, 200);
      mesh.sendSingle(from, "Blink completado");
      Serial.println("✨ Blink ejecutado");
    }
    else if (command == "BLINK5") {
      // Parpadear por 5 segundos (500ms on, 500ms off = 1 segundo por ciclo)
      for (int i = 0; i < 5; i++) {
        digitalWrite(LED_BUILTIN, HIGH);
        delay(500);
        digitalWrite(LED_BUILTIN, LOW);
        delay(500);
      }
      mesh.sendSingle(from, "Blink 5 segundos completado");
      Serial.println("✨ Blink 5 segundos ejecutado");
    }
  }
  
  Serial.println();
}

// Callback: Nueva conexión
void newConnectionCallback(uint32_t nodeId) {
  Serial.println("\n✅ NUEVA CONEXIÓN");
  Serial.print("   Node ID: ");
  Serial.println(nodeId);
  
  meshConnected = true;
  blinkLED(2, 100);
  
  // Si no hay maestro definido, el primer nodo que se conecta es el maestro
  if (masterNodeId == 0) {
    masterNodeId = nodeId;
    Serial.print("🎯 Maestro establecido: ");
    Serial.println(masterNodeId);
  }
  
  Serial.println();
}

// Callback: Cambio en las conexiones
void changedConnectionCallback() {
  Serial.println("\n🔄 CAMBIO EN CONEXIONES");
  
  auto nodes = mesh.getNodeList();
  Serial.print("   Nodos conectados: ");
  Serial.println(nodes.size());
  
  meshConnected = (nodes.size() > 0);
  
  // Verificar si el maestro sigue conectado
  if (masterNodeId != 0) {
    bool masterFound = false;
    for (auto node : nodes) {
      if (node == masterNodeId) {
        masterFound = true;
        break;
      }
    }
    
    if (!masterFound) {
      Serial.println("⚠️ Maestro desconectado");
      masterNodeId = 0;
      
      // Asignar nuevo maestro si hay otros nodos
      if (nodes.size() > 0) {
        masterNodeId = nodes.front();
        Serial.print("🎯 Nuevo maestro: ");
        Serial.println(masterNodeId);
      }
    }
  }
  
  Serial.println();
}

// Callback: Ajuste de tiempo
void nodeTimeAdjustedCallback(int32_t offset) {
  Serial.print("⏰ Tiempo ajustado: ");
  Serial.print(offset);
  Serial.println(" us");
}

// Procesar comandos desde Serial
void processSerialCommand(String command) {
  command.trim();
  
  if (command.length() == 0) return;
  
  Serial.print("\n🔧 Comando recibido: ");
  Serial.println(command);
  
  // Comando: send:<mensaje>
  if (command.startsWith("send:")) {
    String msg = command.substring(5);
    
    if (masterNodeId == 0) {
      Serial.println("❌ Error: No hay nodo maestro definido");
    } else {
      mesh.sendSingle(masterNodeId, msg);
      Serial.print("📤 Mensaje enviado al maestro (");
      Serial.print(masterNodeId);
      Serial.println(")");
    }
  }
  
  // Comando: broadcast:<mensaje>
  else if (command.startsWith("broadcast:")) {
    String msg = command.substring(10);
    mesh.sendBroadcast(msg);
    Serial.println("📣 Mensaje broadcast enviado");
  }
  
  // Comando: status
  else if (command == "status") {
    Serial.println("\n📊 ESTADO DEL SISTEMA");
    Serial.print("   Mi Node ID: ");
    Serial.println(mesh.getNodeId());
    Serial.print("   Maestro: ");
    Serial.println(masterNodeId == 0 ? "No definido" : String(masterNodeId));
    Serial.print("   Nodos conectados: ");
    Serial.println(mesh.getNodeList().size());
    Serial.print("   Mesh conectada: ");
    Serial.println(meshConnected ? "Sí" : "No");
  }
  
  // Comando: nodes
  else if (command == "nodes") {
    auto nodes = mesh.getNodeList();
    Serial.println("\n👥 NODOS CONECTADOS");
    Serial.print("   Total: ");
    Serial.println(nodes.size());
    
    if (nodes.size() > 0) {
      int i = 1;
      for (auto node : nodes) {
        Serial.print("   ");
        Serial.print(i++);
        Serial.print(". Node ID: ");
        Serial.print(node);
        if (node == masterNodeId) {
          Serial.print(" (MAESTRO)");
        }
        Serial.println();
      }
    }
  }
  
  // Comando: master:<nodeId>
  else if (command.startsWith("master:")) {
    String nodeIdStr = command.substring(7);
    uint32_t nodeId = nodeIdStr.toInt();
    
    auto nodes = mesh.getNodeList();
    bool found = false;
    
    for (auto node : nodes) {
      if (node == nodeId) {
        found = true;
        break;
      }
    }
    
    if (found) {
      masterNodeId = nodeId;
      Serial.print("✅ Maestro establecido: ");
      Serial.println(masterNodeId);
    } else {
      Serial.println("❌ Error: Node ID no encontrado");
    }
  }
  
  // Comando: led:on/off
  else if (command.startsWith("led:")) {
    String state = command.substring(4);
    
    if (state == "on") {
      digitalWrite(LED_BUILTIN, HIGH);
      Serial.println("💡 LED encendido");
    } else if (state == "off") {
      digitalWrite(LED_BUILTIN, LOW);
      Serial.println("💡 LED apagado");
    } else {
      Serial.println("❌ Error: Usar 'led:on' o 'led:off'");
    }
  }
  
  // Comando: help
  else if (command == "help") {
    Serial.println("\n📋 COMANDOS DISPONIBLES:");
    Serial.println("   send:<mensaje>          - Enviar mensaje al maestro");
    Serial.println("   broadcast:<mensaje>     - Enviar a todos los nodos");
    Serial.println("   status                  - Ver estado de la mesh");
    Serial.println("   nodes                   - Listar nodos conectados");
    Serial.println("   master:<nodeId>         - Establecer nodo maestro");
    Serial.println("   led:<on/off>            - Controlar LED");
    Serial.println("   help                    - Mostrar esta ayuda");
  }
  
  else {
    Serial.println("❌ Comando desconocido. Escribe 'help' para ver comandos disponibles");
  }
  
  Serial.println();
}

// Parpadear LED
void blinkLED(int times, int delayMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_BUILTIN, HIGH);
    delay(delayMs);
    digitalWrite(LED_BUILTIN, LOW);
    delay(delayMs);
  }
}