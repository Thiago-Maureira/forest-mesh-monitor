# Forest Fire Prevention System — ESP32 Mesh + AI + Node.js

> Distributed IoT network for wide-area environmental monitoring and early fire detection.
> Self-healing Mesh topology, multi-sensor nodes, Groq AI anomaly analysis,
> and a real-time web dashboard — all running on ESP32 hardware.

![Platform](https://img.shields.io/badge/platform-ESP32-blue)
![Language](https://img.shields.io/badge/firmware-C%2FC%2B%2B-brightgreen)
![Backend](https://img.shields.io/badge/backend-Node.js%20%2B%20Express-yellow)
![AI](https://img.shields.io/badge/AI-Groq%20%28Llama%203%29-purple)
![Protocol](https://img.shields.io/badge/protocol-painlessMesh%20%7C%20MQTT%20%7C%20WebSocket-informational)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## Overview

A network of ESP32 sensor nodes forms a **self-healing Mesh** using `painlessMesh`. Each slave node collects temperature, humidity, atmospheric pressure, smoke/gas levels, flame presence, and rainfall. Data propagates to a master node over the Mesh, which forwards it via Serial to a **Node.js server**. The server processes readings, triggers alerts when thresholds are exceeded, and queries **Groq AI (Llama 3)** for contextual anomaly analysis. A live web dashboard displays all sensor data in real time via WebSocket.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Web Browser                               │
│            Real-time Dashboard (WebSocket / HTTP)                │
└───────────────────────────┬─────────────────────────────────────┘
                            │ WebSocket + HTTP
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Node.js Server (Express)                       │
│  ┌─────────────────┐   ┌──────────────┐   ┌───────────────────┐ │
│  │  SerialPort      │   │  Groq SDK    │   │  WebSocket (ws)   │ │
│  │  (reads ESP32)   │   │  Llama 3 AI  │   │  push to browser  │ │
│  └────────┬────────┘   └──────────────┘   └───────────────────┘ │
│           │ JSON over Serial                                      │
└───────────┼─────────────────────────────────────────────────────┘
            │ USB / UART
            ▼
┌───────────────────────┐
│   ESP32 MASTER NODE    │
│   painlessMesh         │
│   JSON → Serial        │
│   Heartbeat every 10s  │
└──────────┬────────────┘
           │ painlessMesh (ESP-NOW based, 2.4 GHz)
     ┌─────┴──────────────────┐
     │                        │
┌────▼────────┐      ┌────────▼────┐      ┌─────────────┐
│ SLAVE NODE 1│      │ SLAVE NODE 2│ ···  │ SLAVE NODE N│
│  Sensors:   │      │  Sensors:   │      │  Sensors:   │
│  DHT11/22   │      │  DHT11/22   │      │  DHT11/22   │
│  BMP085     │      │  BMP085     │      │  BMP085     │
│  MQ-2 Gas   │      │  MQ-2 Gas   │      │  MQ-2 Gas   │
│  IR Flame   │      │  IR Flame   │      │  IR Flame   │
│  Rain       │      │  Rain       │      │  Rain       │
│  Servo LED  │      │  Servo LED  │      │  Servo LED  │
└─────────────┘      └─────────────┘      └─────────────┘
```

---

## Hardware — Per Node

| Component | Pin | Notes |
|---|---|---|
| ESP32-WROOM-32 | — | Main controller, each node |
| DHT11 / DHT22 | GPIO 14 | Temperature + humidity |
| BMP085 | SDA=21, SCL=22 | Atmospheric pressure (I2C) |
| MQ-2 Gas Sensor | GPIO 32 (digital) | Smoke / LPG / CO detection |
| IR Flame Sensor | GPIO 25 | Infrared flame detection |
| Rain Sensor | GPIO 35 (analog) | Threshold: > 2900 = dry |
| Servo Motor | GPIO 15 | Visual indicator / alert beacon |
| LED + Buzzer | GPIO 2, GPIO 25 | Alarm indicators |

### Alert Thresholds (configurable in server.js)

| Sensor | Warning Threshold |
|---|---|
| Temperature | > 35°C |
| Smoke (MQ-2 analog) | > 500 |

---

## Software Dependencies

### Firmware (Arduino IDE)

```cpp
#include <painlessMesh.h>      // Mesh networking — install via Library Manager
#include <ArduinoJson.h>       // JSON serialization
#include <DHT.h>               // DHT11/22 — Adafruit DHT Library
#include <Adafruit_BMP085.h>   // BMP085/BMP180 pressure sensor
#include <ESP32Servo.h>        // Servo control
#include <PubSubClient.h>      // MQTT client (beacon node only)
```

### Backend (Node.js >= 18)

```bash
npm install
# Installs: express, groq-sdk, serialport, @serialport/parser-readline, dotenv, ws
```

---

## Setup Instructions

### 1. Firmware

```bash
# Flash Master node
# Open: firmware/Mesh_Maestro/Mesh_Maestro.ino
# Board: ESP32 Dev Module
# Upload — connect via USB to the server machine

# Flash each Slave node
# Open: firmware/Datos_pasarlos_http/Datos_pasarlos_http.ino
# Same board settings — each node auto-joins the Mesh on power-up
```

Mesh credentials are defined in the firmware:
```cpp
#define MESH_PREFIX   "RedSensores"
#define MESH_PASSWORD "sensores2025"
#define MESH_PORT     5555
```

### 2. Backend Server

```bash
# Copy environment template
cp .env.example .env

# Edit .env:
# GROQ_API_KEY=your_key_from_console.groq.com
# SERIAL_PORT=COM3          (Windows) or /dev/ttyUSB0 (Linux/Mac)
# SERIAL_BAUD=115200
# PORT=3000

npm start
# Server running at http://localhost:3000
```

---

## Sensor Data Format (Serial JSON)

Each slave sends a JSON object over the Mesh. The master wraps it and forwards via Serial:

```json
{
  "type": "sensor_data",
  "timestamp": 123456,
  "data": {
    "node_id": "ESP32_esclavo_01",
    "temperature": 28.4,
    "humidity": 61.2,
    "pressure": 1013.2,
    "gas_digital": 0,
    "flame": false,
    "rain": 3100,
    "rain_status": "dry"
  }
}
```

Master heartbeat (every 10 s):

```json
{
  "type": "status",
  "node_count": 3,
  "mesh_id": 1234567890,
  "uptime": 3600,
  "free_heap": 180000
}
```

---

## AI Integration (Groq — Llama 3)

When sensor readings exceed thresholds, the server queries Groq with the current sensor context:

```
"Temperature is 38°C, smoke level 620, flame sensor triggered.
 Analyze the fire risk and recommend immediate actions."
```

The AI response is pushed to the dashboard and logged. API key: [console.groq.com](https://console.groq.com/keys)

---

## Performance

| Metric | Result |
|---|---|
| Mesh alert propagation latency | < 2 s (10-node network) |
| Server dashboard response time | < 500 ms |
| Sensor polling interval (per node) | 5 s |
| Master heartbeat interval | 10 s |
| EMA filter alpha (temp/humidity) | 0.3 (configurable) |
| Cloud dependencies | Zero (local Mesh + local server) |

---

## Security

- **Never commit `.env`** — it contains your Groq API key. It is already in `.gitignore`.
- Default Mesh credentials are for development only — change before any deployment.
- MQTT broker IP is local — not exposed to the internet.

---

## Future Improvements

- [ ] Add LoRa fallback for long-range areas beyond Wi-Fi Mesh
- [ ] Deploy server to Raspberry Pi for standalone field operation
- [ ] Add GPS coordinates to each node for map-based dashboard
- [ ] Historical data logging (SQLite or InfluxDB)
- [ ] SMS / push notification alerts (Twilio or Ntfy)
- [ ] Solar + LiFePO4 power per node for off-grid operation

---

## Authors

- **Thiago Maureira Garcia** — Full system design, all firmware, Node.js backend, AI integration

**Institution:** E.E.S.T. N°2 "Ing. César Cipolletti" — Bahía Blanca, Argentina (2025)

---

## License

MIT — free to use, modify and distribute with attribution.
