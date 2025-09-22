const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

const API_KEY = 'your_secret_key_123';
const ADMIN_PASSWORD = 'IgorSuperAgent007';

// База данных в памяти
let devicesData = new Map();
let deviceSettings = new Map();
let dailyArchives = new Map(); // Архив по дням

// Директория для сохранения данных
const DATA_DIR = './tracking_data';

// Создаем директорию если не существует
async function initDataDir() {
    try {
        await fs.access(DATA_DIR);
    } catch {
        await fs.mkdir(DATA_DIR, { recursive: true });
    }
}

initDataDir();

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Автосохранение данных каждый час
setInterval(async () => {
    await saveAllData();
}, 3600000);

// Автоархивация в полночь
setInterval(() => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) {
        archiveDailyData();
    }
}, 60000);

// Сохранение всех данных
async function saveAllData() {
    const data = {
        devices: Array.from(devicesData.entries()),
        settings: Array.from(deviceSettings.entries()),
        archives: Array.from(dailyArchives.entries()),
        timestamp: Date.now()
    };
    
    await fs.writeFile(
        path.join(DATA_DIR, 'backup.json'),
        JSON.stringify(data, null, 2)
    );
}

// Загрузка данных при запуске
async function loadData() {
    try {
        const data = await fs.readFile(path.join(DATA_DIR, 'backup.json'), 'utf-8');
        const parsed = JSON.parse(data);
        
        devicesData = new Map(parsed.devices || []);
        deviceSettings = new Map(parsed.settings || []);
        dailyArchives = new Map(parsed.archives || []);
        
        console.log('Data loaded successfully');
    } catch (err) {
        console.log('No previous data found, starting fresh');
    }
}

loadData();

// Архивация данных за день
function archiveDailyData() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateKey = yesterday.toISOString().split('T')[0];
    
    devicesData.forEach((data, deviceId) => {
        const archiveKey = `${deviceId}_${dateKey}`;
        
        // Фильтруем локации за вчерашний день
        const startOfDay = new Date(yesterday);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(yesterday);
        endOfDay.setHours(23, 59, 59, 999);
        
        const dailyLocations = data.locations.filter(loc => {
            const timestamp = loc.timestamp;
            return timestamp >= startOfDay.getTime() && timestamp <= endOfDay.getTime();
        });
        
        if (dailyLocations.length > 0) {
            dailyArchives.set(archiveKey, {
                device_id: deviceId,
                device_name: data.device_name,
                date: dateKey,
                locations: dailyLocations,
                stats: calculateDayStats(dailyLocations)
            });
            
            // Удаляем архивированные данные из основного массива
            data.locations = data.locations.filter(loc => {
                return loc.timestamp > endOfDay.getTime();
            });
        }
    });
    
    saveAllData();
    console.log(`Archived data for ${dateKey}`);
}

// Расчет статистики за день
function calculateDayStats(locations) {
    let totalDistance = 0;
    let maxSpeed = 0;
    
    for (let i = 1; i < locations.length; i++) {
        const dist = calculateDistance(
            locations[i-1].latitude, locations[i-1].longitude,
            locations[i].latitude, locations[i].longitude
        );
        totalDistance += dist;
        
        const timeDiff = (locations[i].timestamp - locations[i-1].timestamp) / 1000;
        if (timeDiff > 0) {
            const speed = (dist / timeDiff) * 3.6; // km/h
            maxSpeed = Math.max(maxSpeed, speed);
        }
    }
    
    return {
        total_points: locations.length,
        total_distance: totalDistance,
        max_speed: maxSpeed,
        start_time: locations[0].timestamp,
        end_time: locations[locations.length - 1].timestamp
    };
}

// Расчет расстояния
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c / 1000; // km
}

// API для получения данных с телефонов
app.post('/api/location', (req, res) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { device_id, device_name, latitude, longitude, timestamp, accuracy, battery } = req.body;
    
    if (!devicesData.has(device_id)) {
        devicesData.set(device_id, {
            device_name: device_name,
            locations: [],
            battery: battery || 0,
            created_at: Date.now()
        });
        
        // Настройки по умолчанию
        deviceSettings.set(device_id, {
            recording_enabled: true,
            auto_archive: true,
            retention_days: 30
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

    // Храним только последние 10000 точек в оперативной памяти
    if (deviceData.locations.length > 10000) {
        deviceData.locations = deviceData.locations.slice(-10000);
    }

    console.log(`[${new Date().toISOString()}] ${device_name}: ${latitude}, ${longitude}`);
    res.json({ success: true });
});

// API для логина
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
        battery: data.battery,
        settings: deviceSettings.get(device_id)
    }));

    res.json(devices);
});

// API для переименования устройства
app.post('/api/device/:device_id/rename', (req, res) => {
    const { device_id } = req.params;
    const { name, token } = req.body;
    
    if (Buffer.from(token, 'base64').toString() !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (devicesData.has(device_id)) {
        devicesData.get(device_id).device_name = name;
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Device not found' });
    }
});

// API для удаления устройства
app.delete('/api/device/:device_id/:token', (req, res) => {
    const { device_id, token } = req.params;
    
    if (Buffer.from(token, 'base64').toString() !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (devicesData.has(device_id)) {
        devicesData.delete(device_id);
        deviceSettings.delete(device_id);
        
        // Удаляем архивы устройства
        for (let key of dailyArchives.keys()) {
            if (key.startsWith(device_id + '_')) {
                dailyArchives.delete(key);
            }
        }
        
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Device not found' });
    }
});

// API для получения архива за день
app.get('/api/archive/:device_id/:date/:token', (req, res) => {
    const { device_id, date, token } = req.params;
    
    if (Buffer.from(token, 'base64').toString() !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const archiveKey = `${device_id}_${date}`;
    if (dailyArchives.has(archiveKey)) {
        res.json(dailyArchives.get(archiveKey));
    } else {
        res.status(404).json({ error: 'Archive not found' });
    }
});

// API для получения списка архивов
app.get('/api/archives/:token', (req, res) => {
    const { token } = req.params;
    
    if (Buffer.from(token, 'base64').toString() !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const archives = Array.from(dailyArchives.entries()).map(([key, data]) => ({
        key,
        device_id: data.device_id,
        device_name: data.device_name,
        date: data.date,
        stats: data.stats
    }));
    
    res.json(archives);
});

// API для удаления данных за день
app.delete('/api/archive/:device_id/:date/:token', (req, res) => {
    const { device_id, date, token } = req.params;
    
    if (Buffer.from(token, 'base64').toString() !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const archiveKey = `${device_id}_${date}`;
    if (dailyArchives.has(archiveKey)) {
        dailyArchives.delete(archiveKey);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Archive not found' });
    }
});

// API для экспорта данных
app.get('/api/export/:device_id/:token', async (req, res) => {
    const { device_id, token } = req.params;
    
    if (Buffer.from(token, 'base64').toString() !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const deviceData = devicesData.get(device_id);
    const archives = [];
    
    for (let [key, data] of dailyArchives.entries()) {
        if (key.startsWith(device_id + '_')) {
            archives.push(data);
        }
    }
    
    const exportData = {
        device: deviceData,
        archives,
        exported_at: new Date().toISOString()
    };
    
    res.json(exportData);
});

// API для импорта данных
app.post('/api/import', async (req, res) => {
    const { token, data } = req.body;
    
    if (Buffer.from(token, 'base64').toString() !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        
        if (parsed.device && parsed.device_id) {
            devicesData.set(parsed.device_id, parsed.device);
        }
        
        if (parsed.archives) {
            parsed.archives.forEach(archive => {
                const key = `${archive.device_id}_${archive.date}`;
                dailyArchives.set(key, archive);
            });
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: 'Invalid data format' });
    }
});

// API для обновления настроек устройства
app.post('/api/device/:device_id/settings', (req, res) => {
    const { device_id } = req.params;
    const { settings, token } = req.body;
    
    if (Buffer.from(token, 'base64').toString() !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (deviceSettings.has(device_id)) {
        deviceSettings.set(device_id, { ...deviceSettings.get(device_id), ...settings });
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Device not found' });
    }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('Saving data before shutdown...');
    await saveAllData();
    process.exit(0);
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
    console.log(`Admin login: admin / ${ADMIN_PASSWORD}`);
});
