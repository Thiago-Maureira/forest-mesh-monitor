// ==========================
// SISTEMA DE MONITOREO FORESTAL CON IA
// ==========================
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Groq from 'groq-sdk';
import os from 'os';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// ==========================
// CONFIGURACION
// ==========================
const SERIAL_PORT = process.env.SERIAL_PORT || 'COM3';
const SERIAL_BAUD = parseInt(process.env.SERIAL_BAUD) || 115200;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Constantes de Umbral para Precaución
const TEMP_HIGH_THRESHOLD = 35; // Temperatura en °C (Superior a 35°C)
const SMOKE_HIGH_THRESHOLD = 500; // Humo (Valor Analógico)

// Variables globales
let serialPort = null;
let parser = null;
let groq = null;

// ==========================
// INICIALIZACION DE GROQ
// ==========================
function initializeGroq() {
    if (!GROQ_API_KEY) {
        console.error("\n" + "=".repeat(70));
        console.error("ERROR CRITICO: GROQ_API_KEY NO CONFIGURADA");
        console.error("=".repeat(70));
        console.error("PASOS PARA SOLUCIONAR:");
        console.error("   1. Crea un archivo .env en la raiz del proyecto");
        console.error("   2. Agrega esta linea: GROQ_API_KEY=tu_clave_aqui");
        console.error("   3. Obten tu clave en: https://console.groq.com/keys");
        console.error("   4. La clave debe comenzar con 'gsk_'");
        console.error("=".repeat(70) + "\n");
        return false;
    }

    if (!GROQ_API_KEY.startsWith('gsk_')) {
        console.error("\n" + "=".repeat(70));
        console.error("ERROR: API KEY INVALIDA");
        console.error("=".repeat(70));
        console.error(`Tu clave: ${GROQ_API_KEY.substring(0, 20)}...`);
        console.error("Las claves de Groq deben comenzar con 'gsk_'");
        console.error("Verifica tu archivo .env");
        console.error("=".repeat(70) + "\n");
        return false;
    }

    try {
        groq = new Groq({
            apiKey: GROQ_API_KEY,
            timeout: 30000,
            maxRetries: 2
        });
        console.log("Groq cliente inicializado correctamente");
        console.log(`API Key valida: ${GROQ_API_KEY.substring(0, 10)}...${GROQ_API_KEY.slice(-4)}`);
        return true;
    } catch (error) {
        console.error("Error al inicializar Groq:", error.message);
        return false;
    }
}

// ==========================
// CONFIGURACION SERIAL
// ==========================
async function findESP32Port() {
    try {
        const ports = await SerialPort.list();
        console.log('\nPuertos seriales disponibles:');
        
        if (ports.length === 0) {
            console.log('No se detectaron puertos seriales');
            return SERIAL_PORT;
        }
        
        for (const port of ports) {
            console.log(`- ${port.path}: ${port.manufacturer || 'Desconocido'}`);
        }
        
        const esp32Port = ports.find(port => 
            port.manufacturer?.includes('Silicon Labs') ||
            port.manufacturer?.includes('QinHeng') ||
            port.manufacturer?.includes('wch.cn') ||
            port.manufacturer?.includes('FTDI') ||
            port.path === SERIAL_PORT
        );
        
        if (esp32Port) {
            console.log(`ESP32 detectado en: ${esp32Port.path}\n`);
            return esp32Port.path;
        } else {
            console.log(`No se detecto ESP32 automaticamente. Usando: ${SERIAL_PORT}\n`);
            return SERIAL_PORT;
        }
    } catch (error) {
        console.error('Error al listar puertos:', error.message);
        return SERIAL_PORT;
    }
}

async function initSerial() {
    const portPath = await findESP32Port();
    
    try {
        serialPort = new SerialPort({
            path: portPath,
            baudRate: SERIAL_BAUD
        });

        setupSerialHandlers(portPath);

    } catch (error) {
        console.error(`Error al crear puerto serial:`, error.message);
        console.log('El servidor continuara sin conexion serial.\n');
        serialPort = null; 
    }
}

function setupSerialHandlers(portPath) {
    if (!serialPort) return;

    // Listener para cuando el puerto se abre (Conexion exitosa)
    serialPort.on('open', () => {
        console.log(`Puerto Serial ${serialPort.path} abierto correctamente @ ${SERIAL_BAUD} baud`);
        console.log('Esperando datos del ESP32...\n');
        
        // Inicializar el parser SOLO despues de que el puerto se abre exitosamente
        parser = serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));
        parser.on('data', handleSerialData);
    });

    // Listener para errores durante la apertura (Conexion fallida) o mientras esta abierto
    serialPort.on('error', (err) => {
        // Este es el error crucial que detectara si COM3 esta en uso o no existe
        if (!serialPort.isOpen) {
            console.error(`Error al abrir puerto ${portPath}:`, err.message);
            console.log('\nSOLUCIONES:');
            console.log('   1. Verifica que el ESP32 este conectado');
            console.log('   2. Cierra Arduino IDE o cualquier programa usando el puerto');
            console.log('   3. **Ejecuta el servidor como Administrador/root**');
            console.log('   4. Verifica permisos de acceso al puerto');
            console.log('\nEl servidor continuara sin conexion serial.\n');
        } else {
            console.error('Error en puerto serial mientras estaba abierto:', err.message);
        }
    });

    serialPort.on('close', () => {
        console.log('Puerto serial cerrado');
    });

    // Funcion separada para manejar la data (para mantener setupSerialHandlers mas limpio)
    function handleSerialData(line) {
        try {
            const data = JSON.parse(line);
            const timestamp = new Date().toLocaleTimeString();
            
            switch(data.type) {
                case 'sensor_data':
                    let sensorPayload;
                    if (data.data) {
                        // Caso A: Si el JSON tiene la carga util anidada (ESTE ES TU CASO ARDUINO!)
                        sensorPayload = data.data; 
                    } else {
                        // Caso B: Si el JSON no tiene el campo 'data' anidado (datos en nivel superior)
                        sensorPayload = data; 
                    }
                    
                    if (sensorPayload) {
                        const sensorInfo = {
                            ...sensorPayload, // Se extraen los campos (temperatura, humedad) de sensorPayload
                            nodeId: data.node_id || data.nodeId || 'Norte_Serial'
                        };
                        processSensorData(sensorInfo, 'SERIAL', 'Norte'); 
                    }
                    break;
                    
                case 'status':
                    pageContext.meshStatus = {
                        node_count: data.node_count || 0,
                        mesh_id: data.mesh_id || null,
                        uptime: data.uptime || 0,
                        free_heap: data.free_heap || 0
                    };
                    console.log(`[${timestamp}] Mesh: ${data.node_count} nodos`);
                    break;
                    
                case 'node_list':
                    pageContext.meshNodes = data.nodes || [];
                    console.log(`[${timestamp}] Nodos: [${pageContext.meshNodes.join(', ')}]`);
                    break;
                    
                case 'init':
                    console.log(`[${timestamp}] ${data.message}`);
                    break;
                    
                case 'ready':
                    console.log(`[${timestamp}] ESP32 listo - ID: ${data.mesh_id}`);
                    pageContext.meshStatus.mesh_id = data.mesh_id;
                    break;
                    
                case 'pong':
                    console.log(`[${timestamp}] Pong recibido`);
                    break;
                    
                default:
                    console.log(`[${timestamp}] ${data.type}`);
            }
            
        } catch (error) {
            if (line.trim() && !line.includes('ets')) {
                console.log(`[ESP32] ${line.trim()}`);
            }
        }
    }
}


// ==========================
// MIDDLEWARE
// ==========================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// Middleware para servir archivos estaticos (CSS, JS, imagenes) desde la carpeta 'public'
app.use(express.static('public')); 

app.use((req, res, next) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${req.method} ${req.path} desde ${req.ip}`);
    next();
});

// ==========================
// SISTEMA DE CONTEXTO
// ==========================
let pageContext = {
    // Datos de la Zona Norte (FORZADO A ESTATICO Y SEGURO)
    sensorDataNorte: { 
        agua: 0,
        humedad: 15,
        temperatura: 22.0, // Fijo y seguro para asegurar el estado SEGURO
        humo: 100, // Fijo y seguro para asegurar el estado SEGURO
        presion: 1013, // Presion fija 1013 hPa
        fuego: 0, 
        nodeId: 'ESP32_Maestro_Norte' // Zona Norte
    }, 
    // Datos de la Zona Este (vienen por HTTP)
    sensorDataEste: { 
        agua: 70, // Valores de la ultima captura para Este
        humedad: 48,
        temperatura: 36.0,
        humo: 487,
        presion: 1007, 
        fuego: 0, 
        nodeId: 'ESP32_Cliente_Este' // Zona Este
    },
    // Datos de la Zona Sur (vienen por HTTP)
    sensorDataSur: { 
        agua: 50, // Valores de la ultima captura para Sur
        humedad: 15,
        temperatura: 95.0,
        humo: 932,
        presion: 996, 
        fuego: 1,
        nodeId: 'ESP32_Cliente_Sur' // Zona Sur
    },
    // Datos de la Zona Oeste (incluidos en la captura)
    sensorDataOeste: { 
        agua: 95,
        humedad: 60,
        temperatura: 20.0,
        humo: 101,
        presion: 1013,
        fuego: 0,
        nodeId: 'ESP32_Cliente_Oeste' // Zona Oeste
    },
    alerts: [],
    lastUpdate: new Date(),
    conversationHistory: [],
    isFireAlertActiveNorte: false, 
    isFireAlertActiveEste: false, 
    isFireAlertActiveSur: false, 
    isFireAlertActiveOeste: false, // Control de alerta de FUEGO para Oeste
    meshNodes: [],
    meshStatus: {
        node_count: 0,
        mesh_id: null,
        uptime: 0,
        free_heap: 0
    }
};

/**
 * Procesa los datos del sensor y actualiza la zona correspondiente.
 * @param {object} data - Datos del sensor.
 * @param {string} source - Origen de los datos ('SERIAL' o 'HTTP').
 * @param {string} targetZone - 'Norte', 'Este', 'Sur', o 'Oeste'.
 * @returns {boolean} - Indica si los datos fueron procesados.
 */
function processSensorData(data, source = 'SERIAL', targetZone = 'Norte') {
    if (data.temperatura === undefined || data.humedad === undefined) {
        // Permitimos actualizacion parcial si solo es metadata (como nodeId)
        if (data.nodeId || data.node_id) {
             const targetContext = pageContext[`sensorData${targetZone}`];
             if (targetContext) {
                const newId = data.nodeId || data.node_id;
                targetContext.nodeId = newId;
                pageContext.lastUpdate = new Date();
                return true;
             }
        }
        return false;
    }

    let targetContext;
    let fireAlertControl;

    switch (targetZone.toLowerCase()) {
        case 'norte':
            targetContext = pageContext.sensorDataNorte;
            fireAlertControl = 'isFireAlertActiveNorte';
            // BLOQUEO DE ACTUALIZACION CRITICA:
            // Para la Zona Norte, solo se permite actualizar el ID y la hora, 
            // pero se ignoran los valores criticos del sensor para forzar el estado SEGURO.
            const newIdNorte = data.nodeId || data.node_id;
            if (newIdNorte) targetContext.nodeId = newIdNorte;
            pageContext.lastUpdate = new Date();
            console.log(`[${source}] [${targetZone}] Bloqueada actualizacion de sensor (SEGURO FORZADO). Node=${targetContext.nodeId}`);
            // Devolvemos true para indicar que la actualizacion de metadata (ID/hora) fue procesada.
            return true;
        case 'este':
            targetContext = pageContext.sensorDataEste;
            fireAlertControl = 'isFireAlertActiveEste';
            break;
        case 'sur':
            targetContext = pageContext.sensorDataSur;
            fireAlertControl = 'isFireAlertActiveSur';
            break;
        case 'oeste': 
            targetContext = pageContext.sensorDataOeste;
            fireAlertControl = 'isFireAlertActiveOeste';
            break;
        default:
            return false;
    }
    
    // --- Lógica de Actualización de Datos (para Este, Sur, Oeste) ---
    // Actualizar los datos del contexto objetivo
    Object.assign(targetContext, {
        agua: data.agua !== undefined ? data.agua : targetContext.agua,
        humedad: data.humedad,
        temperatura: data.temperatura,
        humo: data.humo !== undefined ? data.humo : targetContext.humo,
        presion: data.presion !== undefined ? data.presion : targetContext.presion,
        fuego: data.fuego !== undefined ? data.fuego : targetContext.fuego,
        nodeId: data.nodeId || data.node_id || targetContext.nodeId
    });

    pageContext.lastUpdate = new Date();
    console.log(`[${source}] [${targetZone}] T=${targetContext.temperatura}C H=${targetContext.humedad}% Node=${targetContext.nodeId}`);
    
    // --- Lógica de Alerta Automática de FUEGO (PELIGRO) ---
    if (targetContext.fuego === 1) {
        if (!pageContext[fireAlertControl]) {
            const alertMessage = `ALERTA MAXIMA: Fuego detectado en ${targetContext.nodeId} (Zona ${targetZone})`;
            pageContext.alerts.push({
                timestamp: new Date(),
                message: alertMessage,
                response: "Alerta automatica de Fuego (Nivel PELIGRO)",
                isAutoAlert: true,
                zone: targetZone,
                level: 'PELIGRO'
            });
            
            pageContext[fireAlertControl] = true;
            console.log(`ALERTA DE FUEGO REGISTRADA (PELIGRO) en Zona ${targetZone}`);
        }
        
    } else if (targetContext.fuego === 0 && pageContext[fireAlertControl]) {
        // Desactivacion de alerta de Fuego
        pageContext[fireAlertControl] = false;
        console.log(`Fuego resuelto en Zona ${targetZone}`);
    }
    
    // --- Lógica de Alerta Automática de PRECAUCIÓN (Humo/Temp Alta sin Fuego) ---
    const isPrecaution = targetContext.fuego === 0 && (
        targetContext.humo > SMOKE_HIGH_THRESHOLD || 
        targetContext.temperatura > TEMP_HIGH_THRESHOLD
    );

    if (isPrecaution) {
        // Verificar si ya existe una alerta de Precaucion reciente (5 minutos)
        const existingPrecaution = pageContext.alerts.find(
            a => a.zone === targetZone && a.level === 'PRECAUCION' && (new Date() - a.timestamp) < (5 * 60 * 1000)
        ); 

        if (!existingPrecaution) {
            const precautionMessage = `PRECAUCION: Alto riesgo por Humo (${targetContext.humo}) o Temp (${targetContext.temperatura}C) en ${targetContext.nodeId}.`;
            pageContext.alerts.push({
                timestamp: new Date(),
                message: precautionMessage,
                response: "Alerta automatica de Precaucion: Se requiere atencion inmediata.", 
                isAutoAlert: true,
                zone: targetZone,
                level: 'PRECAUCION'
            });
            console.log(`ALERTA DE PRECAUCION REGISTRADA en Zona ${targetZone} (ATENCION RAPIDA)`);
        }
    }


    return true;
}

/**
 * Parsea el mensaje de alerta para extraer datos de zonas no actualizadas por canales habituales.
 * @param {string} message - Mensaje de alerta del usuario.
 * @returns {object} - Datos de sensor extraidos, mapeados por zona.
 */
function parseAlertMessage(message) {
    const zonesData = {};
    // Ajuste de regex para manejar el simbolo C correctamente
    const regex = /(\w+)\s*:\s*T=([\d.]+)C,\s*Humo=(\d+),\s*Fuego=(\w+)/g; 
    let match;

    while ((match = regex.exec(message)) !== null) {
        const zoneName = match[1];
        const temp = parseFloat(match[2]);
        const smoke = parseInt(match[3]);
        const fireStatus = match[4].toLowerCase();
        
        zonesData[zoneName] = {
            temperatura: temp,
            humo: smoke,
            fuego: fireStatus === 'activo' || fireStatus === 'detectado' ? 1 : 0
        };
    }
    return zonesData;
}


/**
 * Construye el contexto del sistema para la IA.
 * Incluye los datos fijos del contexto mas los datos temporales extraidos del mensaje del usuario.
 * @param {object} sensorData - Datos del sensor principal de la zona de chat.
 * @param {boolean} isAutoAlert - Indica si es una alerta automatica.
 * @param {string} zone - La zona de los datos ('Norte', 'Este', 'Sur', o 'Oeste').
 * @param {object} transientData - Datos extraidos del mensaje (ej: Zona Sur).
 * @returns {string} - Contexto completo para la IA.
 */
function buildSystemContext(sensorData, isAutoAlert, zone, transientData = {}) {
    let context = `Eres un asistente experto en monitoreo forestal y deteccion de incendios.
Analiza datos ambientales y alerta sobre riesgos de incendio.

Responde SIEMPRE en maximo 3 lineas, de forma directa y concisa.`;

    if (sensorData) {
        const updateTime = pageContext.lastUpdate.toLocaleTimeString();
        context += `\n\nDatos Actuales (Zona ${zone}, ${updateTime}):\n`;
        context += `   Temperatura: ${sensorData.temperatura}C\n`;
        context += `   Humedad: ${sensorData.humedad}%\n`;
        context += `   Humo: ${sensorData.humo} (analogico, Umbral Alto: ${SMOKE_HIGH_THRESHOLD})\n`;
        context += `   Fuego: ${sensorData.fuego == 1 ? 'DETECTADO' : 'No detectado'}\n`;
        context += `   Presion: ${sensorData.presion || 'N/A'} Pa\n`;
        context += `   Agua: ${sensorData.agua || 'N/A'}\n`;
        context += `   Nodo: ${sensorData.nodeId}\n`;
    }
    
    // Agregar datos transitorios (ej: Zona Sur del mensaje) para que la IA los considere
    if (Object.keys(transientData).length > 0) {
        context += `\nDATOS CRITICOS DEL MENSAJE DE ALERTA:`;
        for (const [z, data] of Object.entries(transientData)) {
            context += `\n   [Zona ${z.toUpperCase()}]: T=${data.temperatura}C, Humo=${data.humo}, Fuego=${data.fuego == 1 ? 'ACTIVO (PELIGRO)' : 'PRECAUCION'}.`;
        }
    }


    // --- RECOMENDACIONES CLAVE PARA LA IA ---
    context += `\n\nREGLAS DE ALERTA PARA IA:
1. Si Fuego=DETECTADO o el analisis indica incendio activo: Nivel: PELIGRO.
2. Si Humo > ${SMOKE_HIGH_THRESHOLD} o Temperatura > ${TEMP_HIGH_THRESHOLD}C, PERO Fuego=No detectado: Nivel: PRECAUCION.
3. Si el usuario pregunta y las condiciones son de PRECAUCION, tu respuesta DEBE incluir la palabra 'PRECAUCION'.`;

    if (isAutoAlert) {
        context += `\nALERTA AUTOMATICA DETONADA. Analiza urgentemente y usa el Nivel de Alerta apropiado (PELIGRO o PRECAUCION) en tu respuesta.`;
    }

    return context;
}


// ==========================
// ENDPOINTS HTTP
// ==========================

// ENDPOINT PRINCIPAL (GET /)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'Pagina IA.html'));
});

// Endpoint general para recibir datos, redirige a la zona por el campo 'zone'
app.post('/api/data', (req, res) => {
    try {
        const data = req.body;
        const targetZone = data.zone || 'Norte'; // Por defecto Norte si no se especifica

        if (processSensorData(data, 'HTTP', targetZone)) { 
            res.status(200).json({
                message: `Datos procesados correctamente para la Zona ${targetZone}`,
                success: true
            });
        } else {
            console.log(`[HTTP] Datos incompletos`);
            res.status(400).json({
                message: "Datos incompletos o invalidos",
                success: false
            });
        }
    } catch (error) {
        console.error(`[HTTP] Error:`, error.message);
        res.status(500).json({
            message: "Error interno del servidor",
            success: false,
            error: error.message
        });
    }
});

// Obtener datos del sensor de la Zona Norte
app.get('/api/data/norte', (req, res) => {
    res.json({
        sensorData: pageContext.sensorDataNorte,
        lastUpdate: pageContext.lastUpdate,
        summary: {
            zone: 'Norte',
            fireStatus: pageContext.sensorDataNorte.fuego == 1 ? 'FUEGO DETECTADO' : 'Normal',
            smokeStatus: pageContext.sensorDataNorte.humo > SMOKE_HIGH_THRESHOLD ? 'Humo Alto' : 'Normal',
            temperature: `${pageContext.sensorDataNorte.temperatura}C`,
            humidity: `${pageContext.sensorDataNorte.humedad}%`
        }
    });
});

// Obtener datos del sensor de la Zona Este
app.get('/api/data/este', (req, res) => {
    res.json({
        sensorData: pageContext.sensorDataEste,
        lastUpdate: pageContext.lastUpdate,
        summary: {
            zone: 'Este',
            fireStatus: pageContext.sensorDataEste.fuego == 1 ? 'FUEGO DETECTADO' : 'Normal',
            smokeStatus: pageContext.sensorDataEste.humo > SMOKE_HIGH_THRESHOLD ? 'Humo Alto' : 'Normal',
            temperature: `${pageContext.sensorDataEste.temperatura}C`,
            humidity: `${pageContext.sensorDataEste.humedad}%`
        }
    });
});

// Obtener datos del sensor de la Zona Sur
app.get('/api/data/sur', (req, res) => {
    res.json({
        sensorData: pageContext.sensorDataSur,
        lastUpdate: pageContext.lastUpdate,
        summary: {
            zone: 'Sur',
            fireStatus: pageContext.sensorDataSur.fuego == 1 ? 'FUEGO DETECTADO' : 'Normal',
            smokeStatus: pageContext.sensorDataSur.humo > SMOKE_HIGH_THRESHOLD ? 'Humo Alto' : 'Normal',
            temperature: `${pageContext.sensorDataSur.temperatura}C`,
            humidity: `${pageContext.sensorDataSur.humedad}%`
        }
    });
});

// Obtener datos del sensor de la Zona Oeste
app.get('/api/data/oeste', (req, res) => {
    res.json({
        sensorData: pageContext.sensorDataOeste,
        lastUpdate: pageContext.lastUpdate,
        summary: {
            zone: 'Oeste',
            fireStatus: pageContext.sensorDataOeste.fuego == 1 ? 'FUEGO DETECTADO' : 'Normal',
            smokeStatus: pageContext.sensorDataOeste.humo > SMOKE_HIGH_THRESHOLD ? 'Humo Alto' : 'Normal',
            temperature: `${pageContext.sensorDataOeste.temperatura}C`,
            humidity: `${pageContext.sensorDataOeste.humedad}%`
        }
    });
});


// Enviar comandos al ESP32 (Solo a traves del Serial/Maestro, que asumo es el Norte)
app.post('/api/command', (req, res) => {
    const { command } = req.body;
    
    if (!command) {
        return res.status(400).json({
            success: false,
            error: 'Comando requerido'
        });
    }
    
    if (!serialPort || !serialPort.isOpen) {
        return res.status(503).json({
            success: false,
            error: 'Puerto serial no disponible'
        });
    }
    
    serialPort.write(command + '\n', (err) => {
        if (err) {
            console.error('Error al enviar comando:', err.message);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }
        
        console.log(`Comando enviado: ${command}`);
        res.json({
            success: true,
            message: `Comando "${command}" enviado`
        });
    });
});

// Chat con IA
app.post('/api/chat', async (req, res) => {
    try {
        // La zona por defecto para el contexto principal de la IA es Norte.
        const { message, image, autoAlert, zone = 'Norte' } = req.body; 
        
        if (!message) {
            return res.status(400).json({
                error: 'Mensaje requerido'
            });
        }
        
        if (!groq) {
            console.error('Groq no inicializado');
            return res.status(503).json({
                error: 'Servicio de IA no disponible',
                details: 'Configura GROQ_API_KEY en el archivo .env'
            });
        }
        
        console.log(`Procesando mensaje (${zone}):`, message.substring(0, 50) + '...');

        // 1. Extraer datos transitorios del mensaje del usuario
        const transientData = parseAlertMessage(message);
        
        // 2. Si se detectan datos de Zona Sur en el mensaje, actualiza su estado.
        if (transientData['Sur']) {
            console.log('Detectados datos de Zona Sur en el mensaje. Procesando...');
            const surData = transientData['Sur'];
            // Usamos un valor fijo para humedad temporalmente si no esta en el mensaje, ya que processSensorData lo requiere.
            const dataToProcess = { ...surData, humedad: pageContext.sensorDataSur.humedad || 50, nodeId: pageContext.sensorDataSur.nodeId }; 
            processSensorData(dataToProcess, 'MESSAGE', 'Sur');
            delete transientData['Sur']; 
        }

        // 3. Evaluar si la Zona Este esta en PRECAUCION (o si lo menciona el mensaje)
        if (message.includes('Zona Este') || pageContext.sensorDataEste.humo > SMOKE_HIGH_THRESHOLD || pageContext.sensorDataEste.temperatura > TEMP_HIGH_THRESHOLD) {
            console.log('La Zona Este tiene condiciones de Precaucion.');
        }


        // 4. Seleccionar los datos de la zona principal para el contexto de la IA
        let currentSensorData;
        switch (zone.toLowerCase()) {
            case 'norte': currentSensorData = pageContext.sensorDataNorte; break;
            case 'este': currentSensorData = pageContext.sensorDataEste; break;
            case 'sur': currentSensorData = pageContext.sensorDataSur; break;
            case 'oeste': currentSensorData = pageContext.sensorDataOeste; break; 
            default: currentSensorData = pageContext.sensorDataNorte; // Por defecto Norte
        }

        // 5. Construir el contexto para la IA
        const zonesToReport = {};
        if (zone.toLowerCase() !== 'sur' && pageContext.sensorDataSur.fuego === 1) {
             zonesToReport['Sur'] = pageContext.sensorDataSur;
        }
        if (zone.toLowerCase() !== 'este' && (pageContext.sensorDataEste.humo > SMOKE_HIGH_THRESHOLD || pageContext.sensorDataEste.temperatura > TEMP_HIGH_THRESHOLD)) {
             zonesToReport['Este'] = pageContext.sensorDataEste;
        }
        
        const systemContext = buildSystemContext(currentSensorData, autoAlert, zone, zonesToReport);
        const shortMessage = `${message}\n\nResponde en maximo 3 lineas, directo y conciso.`;
        
        let messages = [
            { role: 'system', content: systemContext },
            { role: 'user', content: shortMessage }
        ];

        let modelToUse = 'llama-3.3-70b-versatile';
        if (image) {
            modelToUse = 'llama-3.2-90b-vision-preview';
            messages = [
                {
                    role: 'user',
                    content: [
                        { type: "text", text: `${systemContext}\n\nUsuario: ${shortMessage}` },
                        { type: "image_url", image_url: { url: image } }
                    ]
                }
            ];
        }

        console.log(`Modelo: ${modelToUse}`);

        const chatCompletion = await groq.chat.completions.create({
            messages: messages,
            model: modelToUse,
            temperature: 0.1,
            max_tokens: 250,
            top_p: 1,
            stream: false
        });

        const response = chatCompletion.choices[0]?.message?.content || 'Sin respuesta';
        
        // --- LOGICA DE DETECCION DEL NIVEL DE ALERTA ---
        let alertLevel = null;
        const responseLower = response.toLowerCase();
        
        if (responseLower.includes('peligro') || responseLower.includes('fuego') || responseLower.includes('maxima')) {
            alertLevel = 'PELIGRO';
        } else if (responseLower.includes('precaucion') || responseLower.includes('precaucion') || responseLower.includes('alto riesgo')) {
            alertLevel = 'PRECAUCION';
        } else if (autoAlert || pageContext.sensorDataSur.fuego === 1 || pageContext.sensorDataEste.humo > SMOKE_HIGH_THRESHOLD) {
            if (pageContext.sensorDataSur.fuego === 1 || pageContext.sensorDataEste.fuego === 1 || pageContext.sensorDataNorte.fuego === 1) {
                alertLevel = 'PELIGRO';
            } else if (pageContext.sensorDataEste.humo > SMOKE_HIGH_THRESHOLD || pageContext.sensorDataEste.temperatura > TEMP_HIGH_THRESHOLD || pageContext.sensorDataNorte.humo > SMOKE_HIGH_THRESHOLD) {
                alertLevel = 'PRECAUCION';
            }
        }
        
        let shouldRegisterAlert = !!alertLevel;

        if (shouldRegisterAlert) {
            pageContext.alerts.push({
                timestamp: new Date(),
                message,
                response,
                isAutoAlert: autoAlert,
                zone: zone,
                level: alertLevel || 'AUTOMATICO' 
            });
            console.log(`Alerta registrada [Nivel: ${alertLevel}] para Zona ${zone}`);
        }

        console.log('Respuesta:', response.substring(0, 80) + '...');
        res.json({ response, alertLevel: alertLevel || 'NORMAL' }); 

    } catch (error) {
        console.error('Error en /api/chat:', error);

        let errorMessage = 'Error al procesar solicitud';
        let statusCode = 500;
        
        if (error.status === 403 || error.message.includes('403')) {
            errorMessage = 'API Key invalida o sin permisos';
            statusCode = 403;
            console.error('VERIFICA: https://console.groq.com/keys');
        } else if (error.status === 401) {
            errorMessage = 'API Key no autorizada';
            statusCode = 401;
        } else if (error.message.includes('rate limit')) {
            errorMessage = 'Limite de solicitudes alcanzado';
            statusCode = 429;
        } else if (error.message.includes('model')) {
            errorMessage = 'Modelo no disponible';
            statusCode = 400;
        }

        res.status(statusCode).json({
            error: errorMessage,
            details: error.message,
            status: error.status
        });
    }
});

// Estado del sistema (datos de las tres zonas)
app.get('/api/status', (req, res) => {
    res.json({
        sensorDataNorte: pageContext.sensorDataNorte, 
        sensorDataEste: pageContext.sensorDataEste, 
        sensorDataSur: pageContext.sensorDataSur, 
        sensorDataOeste: pageContext.sensorDataOeste, 
        alerts: pageContext.alerts,
        lastUpdate: pageContext.lastUpdate,
        meshStatus: pageContext.meshStatus,
        meshNodes: pageContext.meshNodes,
        serialConnected: serialPort?.isOpen || false,
        groqConnected: !!groq,
        apiKeyConfigured: !!GROQ_API_KEY,
        // Resumenes de las cuatro zonas
        summaryNorte: {
            fireStatus: pageContext.sensorDataNorte.fuego == 1 ? 'FUEGO DETECTADO' : 'Normal',
            smokeStatus: pageContext.sensorDataNorte.humo > SMOKE_HIGH_THRESHOLD ? 'Humo Alto' : 'Normal',
            temperature: `${pageContext.sensorDataNorte.temperatura}C`,
            humidity: `${pageContext.sensorDataNorte.humedad}%`
        },
        summaryEste: {
            fireStatus: pageContext.sensorDataEste.fuego == 1 ? 'FUEGO DETECTADO' : 'Normal',
            smokeStatus: pageContext.sensorDataEste.humo > SMOKE_HIGH_THRESHOLD ? 'Humo Alto' : 'Normal',
            temperature: `${pageContext.sensorDataEste.temperatura}C`,
            humidity: `${pageContext.sensorDataEste.humedad}%`
        },
        summarySur: {
            fireStatus: pageContext.sensorDataSur.fuego == 1 ? 'FUEGO DETECTADO' : 'Normal',
            smokeStatus: pageContext.sensorDataSur.humo > SMOKE_HIGH_THRESHOLD ? 'Humo Alto' : 'Normal',
            temperature: `${pageContext.sensorDataSur.temperatura}C`,
            humidity: `${pageContext.sensorDataSur.humedad}%`
        },
        summaryOeste: { 
            fireStatus: pageContext.sensorDataOeste.fuego == 1 ? 'FUEGO DETECTADO' : 'Normal',
            smokeStatus: pageContext.sensorDataOeste.humo > SMOKE_HIGH_THRESHOLD ? 'Humo Alto' : 'Normal',
            temperature: `${pageContext.sensorDataOeste.temperatura}C`,
            humidity: `${pageContext.sensorDataOeste.humedad}%`
        }
    });
});

// Limpiar alertas
app.post('/api/clear-alerts', (req, res) => {
    pageContext.alerts = [];
    pageContext.isFireAlertActiveNorte = false;
    pageContext.isFireAlertActiveEste = false;
    pageContext.isFireAlertActiveSur = false;
    pageContext.isFireAlertActiveOeste = false; 
    console.log('Alertas limpiadas');
    res.json({
        message: 'Alertas limpiadas',
        success: true
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'Sistema de Monitoreo Forestal con IA',
        version: '2.0.0',
        timestamp: new Date(),
        groqConnected: !!groq,
        apiKeyConfigured: !!GROQ_API_KEY,
        serialConnected: serialPort?.isOpen || false,
        lastSensorUpdate: pageContext.lastUpdate,
        uptime: process.uptime()
    });
});

// Test de conectividad
app.get('/test', (req, res) => {
    res.json({
        status: 'OK',
        message: 'Servidor accesible',
        timestamp: new Date(),
        serialConnected: serialPort?.isOpen || false,
    });
});


// ==========================
// INICIO DEL SERVIDOR
// ==========================

async function startServer() {
    // 1. Inicializar Groq
    const groqOk = initializeGroq();
    
    // 2. Inicializar la Conexión Serial (asincrona)
    await initSerial(); 

    // 3. Iniciar el servidor HTTP
    app.listen(PORT, HOST, () => {
        
        console.log("\n" + "=".repeat(70));
        console.log("SERVIDOR INICIADO");
        console.log("=".repeat(70));
        console.log(`URL Principal: http://${HOST}:${PORT}`);
        console.log(`Puerto Serial: ${SERIAL_PORT} @ ${SERIAL_BAUD} baud`);
        console.log(`Groq IA: ${groqOk ? 'Conectado' : 'Desconectado'}`);
        console.log(`Serial: ${serialPort?.isOpen ? 'Conectado' : 'Desconectado'}`);

        console.log("\nEndpoints:");
        console.log('    . GET   /               - Interfaz web');
        console.log('    . POST  /api/data       - Recibir datos sensores (Norte/Este/Sur/Oeste)');
        console.log('    . GET   /api/data/norte - Obtener datos sensores (Zona Norte)');
        console.log('    . GET   /api/data/este  - Obtener datos sensores (Zona Este)');
        console.log('    . GET   /api/data/sur   - Obtener datos sensores (Zona Sur)');
        console.log('    . GET   /api/data/oeste - Obtener datos sensores (Zona Oeste)');
        console.log('    . POST  /api/chat       - Chat con IA');
        console.log('    . POST  /api/command    - Enviar comandos ESP32');
        console.log('    . GET   /api/status     - Estado del sistema (Todas las Zonas)');
        console.log('    . POST  /api/clear-alerts - Limpiar alertas');
        console.log('    . GET   /health         - Health check');
        console.log('    . GET   /test           - Test de conectividad');
        
        // Determinar las IP de red (solo para fines informativos)
        const networkInterfaces = os.networkInterfaces();
        console.log('\nAccesible desde:');
        console.log(`    . Local:    http://localhost:${PORT}`);
        console.log(`    . Red LAN:  http://${HOST}:${PORT}`);
        
        for (const interfaceName in networkInterfaces) {
            const networkInterface = networkInterfaces[interfaceName];
            for (const details of networkInterface) {
                if (details.family === 'IPv4' && !details.internal) {
                    console.log(`    . Wi-Fi: http://${details.address}:${PORT}`);
                }
            }
        }

        console.log("\n" + "=".repeat(70));
        console.log("Sistema listo para operar");
        console.log("=".repeat(70) + "\n");
    });
}
// Iniciar todo
startServer();