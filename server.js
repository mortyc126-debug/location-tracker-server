const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;

const API_KEY = 'your_secret_key_123';

// Храним данные по устройствам
let devicesData = new Map();

app.use(express.json());
app.use(express.static('public'));

// API для получения данных с телефонов
app.post('/api/location', (req, res) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { device_id, device_name, latitude, longitude, timestamp, accuracy } = req.body;
    
    if (!devicesData.has(device_id)) {
        devicesData.set(device_id, {
            device_name: device_name,
            locations: []
        });
    }

    const deviceData = devicesData.get(device_id);
    deviceData.device_name = device_name; // Обновляем имя
    
    deviceData.locations.push({
        latitude,
        longitude,
        timestamp,
        accuracy,
        date: new Date(timestamp)
    });

    // Храним только последние 1000 точек на устройство
    if (deviceData.locations.length > 1000) {
        deviceData.locations = deviceData.locations.slice(-1000);
    }

    console.log(`[${device_name}] New location: ${latitude}, ${longitude}`);
    res.json({ success: true });
});

// API для получения списка устройств
app.get('/api/devices/:password', (req, res) => {
    const password = req.params.password;
    
    if (password !== 'brother_tracker_2025') {
        return res.status(401).json({ error: 'Wrong password' });
    }

    const devices = Array.from(devicesData.entries()).map(([device_id, data]) => ({
        device_id,
        device_name: data.device_name,
        last_seen: data.locations.length > 0 ? 
            data.locations[data.locations.length - 1].timestamp : null,
        location_count: data.locations.length
    }));

    res.json(devices);
});

// API для получения данных конкретного устройства
app.get('/api/device/:device_id/:password', (req, res) => {
    const { device_id, password } = req.params;
    
    if (password !== 'brother_tracker_2025') {
        return res.status(401).json({ error: 'Wrong password' });
    }

    if (!devicesData.has(device_id)) {
        return res.status(404).json({ error: 'Device not found' });
    }

    const deviceData = devicesData.get(device_id);
    res.json({
        device_id,
        device_name: deviceData.device_name,
        locations: deviceData.locations
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
    console.log(`Access from network: http://192.168.0.101:${port}`);
});