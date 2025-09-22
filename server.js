const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

const API_KEY = 'your_secret_key_123';
const ADMIN_PASSWORD = 'IgorSuperAgent007'; // Новый пароль

// Храним данные по устройствам
let devicesData = new Map();

app.use(express.json());
app.use(express.static('public'));

// Middleware для расшифровки данных
function decryptData(encryptedData) {
    try {
        // Декодируем из Base64
        const encrypted = Buffer.from(encryptedData, 'base64').toString();
        const key = API_KEY;
        let decrypted = '';
        
        for (let i = 0; i < encrypted.length; i++) {
            decrypted += String.fromCharCode(encrypted.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        
        return decrypted;
    } catch (e) {
        return encryptedData; // Возвращаем как есть если не зашифровано
    }
}

// API для получения данных с телефонов
app.post('/api/location', (req, res) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    let locationData;
    
    // Проверяем, зашифрованы ли данные
    if (req.body.data) {
        const decryptedData = decryptData(req.body.data);
        try {
            locationData = JSON.parse(decryptedData);
        } catch (e) {
            locationData = req.body; // Если не удалось расшифровать
        }
    } else {
        locationData = req.body;
    }

    const { device_id, device_name, latitude, longitude, timestamp, accuracy, battery } = locationData;
    
    if (!devicesData.has(device_id)) {
        devicesData.set(device_id, {
            device_name: device_name,
            locations: [],
            battery: battery || 0
        });
    }

    const deviceData = devicesData.get(device_id);
    deviceData.device_name = device_name;
    deviceData.battery = battery || 0;
    
    deviceData.locations.push({
        latitude,
        longitude,
        timestamp: timestamp || Date.now(),
        accuracy: accuracy || 0,
        date: new Date(timestamp || Date.now())
    });

    // Храним только последние 1000 точек
    if (deviceData.locations.length > 1000) {
        deviceData.locations = deviceData.locations.slice(-1000);
    }

    console.log(`[${new Date().toISOString()}] ${device_name}: ${latitude}, ${longitude} | Battery: ${battery}%`);
    res.json({ success: true });
});

// API для проверки логина
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === 'admin' && password === ADMIN_PASSWORD) {
        res.json({ success: true, token: Buffer.from(ADMIN_PASSWORD).toString('base64') });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// API для получения списка устройств
app.get('/api/devices/:token', (req, res) => {
    const token = req.params.token;
    
    if (Buffer.from(token, 'base64').toString() !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const devices = Array.from(devicesData.entries()).map(([device_id, data]) => ({
        device_id,
        device_name: data.device_name,
        last_seen: data.locations.length > 0 ? 
            data.locations[data.locations.length - 1].timestamp : null,
        last_location: data.locations.length > 0 ? {
            lat: data.locations[data.locations.length - 1].latitude,
            lng: data.locations[data.locations.length - 1].longitude
        } : null,
        location_count: data.locations.length,
        battery: data.battery
    }));

    res.json(devices);
});

// API для получения данных устройства
app.get('/api/device/:device_id/:token', (req, res) => {
    const { device_id, token } = req.params;
    
    if (Buffer.from(token, 'base64').toString() !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!devicesData.has(device_id)) {
        return res.status(404).json({ error: 'Device not found' });
    }

    const deviceData = devicesData.get(device_id);
    res.json({
        device_id,
        device_name: deviceData.device_name,
        battery: deviceData.battery,
        locations: deviceData.locations
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
    console.log(`Admin login: admin / ${ADMIN_PASSWORD}`);
});
