const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Ваш секретный ключ API и пароль админа
const API_KEY = 'your_secret_key_123';
const ADMIN_PASSWORD = 'IgorSuperAgent007';

// Подключение к Supabase
const supabaseUrl = 'https://hapwopjrgwdjwfawpjwq.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Директория для сохранения данных (уже не используется, но оставлена для совместимости)
const DATA_DIR = './tracking_data';
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

// Автосохранение и архивация больше не нужны, так как Supabase сохраняет данные мгновенно
// setInterval(async () => { await saveAllData(); }, 3600000);
// setInterval(() => { ... }, 60000);

// API для получения списка всех устройств и их последней точки
app.get('/api/devices', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('locations')
            .select('device_id, latitude, longitude, timestamp')
            .order('timestamp', { ascending: false });

        if (error) throw error;

        // Группируем данные по device_id, чтобы получить последнюю точку для каждого
        const devices = data.reduce((acc, curr) => {
            if (!acc[curr.device_id]) {
                acc[curr.device_id] = {
                    device_id: curr.device_id,
                    latitude: curr.latitude,
                    longitude: curr.longitude,
                    last_updated: curr.timestamp
                };
            }
            return acc;
        }, {});

        res.json(Object.values(devices));
    } catch (error) {
        console.error('Error fetching devices:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// API для получения данных одного устройства
app.get('/api/device/:device_id', async (req, res) => {
    const { device_id } = req.params;
    try {
        const { data: locations, error: locationsError } = await supabase
            .from('locations')
            .select('*')
            .eq('device_id', device_id)
            .order('timestamp', { ascending: false });

        if (locationsError) throw locationsError;

        const { data: settings, error: settingsError } = await supabase
            .from('device_settings')
            .select('settings')
            .eq('device_id', device_id)
            .single();

        if (settingsError && settingsError.code !== 'PGRST116') { // PGRST116: "No rows found"
            throw settingsError;
        }

        const deviceData = {
            device_id,
            locations: locations.map(loc => ({
                latitude: loc.latitude,
                longitude: loc.longitude,
                timestamp: loc.timestamp,
                accuracy: loc.accuracy,
                battery: loc.battery
            })),
            settings: settings ? settings.settings : {}
        };
        
        res.json(deviceData);
    } catch (error) {
        console.error('Error fetching device data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// API для сохранения данных о местоположении
app.post('/api/device/:device_id/location', async (req, res) => {
    const { device_id } = req.params;
    const { latitude, longitude, timestamp, accuracy, battery, key } = req.body;

    if (key !== API_KEY) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    if (!latitude || !longitude) {
        return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    try {
        const { data, error } = await supabase
            .from('locations')
            .insert([
                {
                    device_id,
                    latitude,
                    longitude,
                    timestamp: timestamp || Date.now(),
                    accuracy: accuracy || 0,
                    battery: battery || 0
                }
            ]);
        
        if (error) throw error;
        
        res.status(200).json({ success: true, message: 'Location saved', data });
    } catch (error) {
        console.error('Error inserting data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// API для получения истории по дате
app.get('/api/device/:device_id/history', async (req, res) => {
    const { device_id } = req.params;
    const { date } = req.query;

    if (!date) {
        return res.status(400).json({ error: 'Date query parameter is required' });
    }

    try {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const { data, error } = await supabase
            .from('locations')
            .select('*')
            .eq('device_id', device_id)
            .gte('timestamp', startOfDay.getTime())
            .lte('timestamp', endOfDay.getTime())
            .order('timestamp', { ascending: true });

        if (error) throw error;

        res.json({ date, locations: data });
    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// API для обновления настроек устройства
app.post('/api/device/:device_id/settings', async (req, res) => {
    const { device_id } = req.params;
    const { settings, token } = req.body;
    
    if (Buffer.from(token, 'base64').toString() !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        const { data, error } = await supabase
            .from('device_settings')
            .upsert({ device_id, settings })
            .select();

        if (error) throw error;
        
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

// API для загрузки резервной копии - теперь не требуется, так как Supabase хранит данные
// app.post('/api/backup', async (req, res) => {
// ...
// });
