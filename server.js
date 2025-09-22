const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Supabase configuration
const supabaseUrl = 'https://hapwopjrgwdjwfawpjwq.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const API_KEY = 'your_secret_key_123';
const ADMIN_PASSWORD = 'IgorSuperAgent007';

// Cache для устройств
let devicesCache = new Map();

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// API для получения данных с телефонов
app.post('/api/location', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { device_id, device_name, latitude, longitude, timestamp, accuracy, battery } = req.body;
    try {
        await supabase.from('locations').insert([{
            device_id,
            latitude,
            longitude,
            accuracy: accuracy || 0,
            battery: battery || 0,
            timestamp: timestamp || Date.now()
        }]);

        devicesCache.set(device_id, { device_name, last_seen: Date.now(), battery });

        await supabase.from('device_settings').upsert([{
            device_id,
            settings: {
                device_name,
                last_seen: Date.now(),
                battery,
                recording_enabled: true,
                auto_archive: true
            }
        }]);

        console.log(`[${new Date().toISOString()}] ${device_name}: ${latitude}, ${longitude}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving location:', error);
        res.status(500).json({ error: 'Database error' });
    }
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
app.get('/api/devices/:token', async (req, res) => {
    if (Buffer.from(req.params.token, 'base64').toString() !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const { data: settings } = await supabase.from('device_settings').select('*');
        const devices = await Promise.all(settings.map(async (device) => {
            const { data: lastLocation } = await supabase
                .from('locations')
                .select('*')
                .eq('device_id', device.device_id)
                .order('timestamp', { ascending: false })
                .limit(1)
                .single();

            const { count } = await supabase
                .from('locations')
                .select('*', { count: 'exact', head: true })
                .eq('device_id', device.device_id);

            return {
                device_id: device.device_id,
                device_name: device.settings?.device_name || 'Unknown',
                last_seen: lastLocation?.timestamp || null,
                last_location: lastLocation ? {
                    lat: lastLocation.latitude,
                    lng: lastLocation.longitude
                } : null,
                location_count: count || 0,
                battery: device.settings?.battery || 0,
                settings: device.settings
            };
        }));
        res.json(devices);
    } catch (error) {
        console.error('Error fetching devices:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// API для получения данных устройства
app.get('/api/device/:device_id/:token', async (req, res) => {
    const { device_id, token } = req.params;
    if (Buffer.from(token, 'base64').toString() !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const { data: settings } = await supabase
            .from('device_settings')
            .select('*')
            .eq('device_id', device_id)
            .single();

        const { data: locations } = await supabase
            .from('locations')
            .select('*')
            .eq('device_id', device_id)
            .order('timestamp', { ascending: false })
            .limit(1000);

        res.json({
            device_id,
            device_name: settings?.settings?.device_name || 'Unknown',
            battery: settings?.settings?.battery || 0,
            locations: locations.reverse()
        });
    } catch (error) {
        console.error('Error fetching device data:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// API для истории устройства
app.get('/api/device/:device_id/history/:token', async (req, res) => {
    const { device_id, token } = req.params;
    if (Buffer.from(token, 'base64').toString() !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const { data: locations } = await supabase
            .from('locations')
            .select('*')
            .eq('device_id', device_id)
            .order('timestamp', { ascending: true });

        res.json({ locations });
    } catch (err) {
        console.error('Error fetching history:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API для переименования устройства
app.post('/api/device/:device_id/rename', async (req, res) => {
    const { device_id } = req.params;
    const { name, token } = req.body;
    if (Buffer.from(token, 'base64').toString() !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const { data: current } = await supabase
            .from('device_settings')
            .select('*')
            .eq('device_id', device_id)
            .single();

        const updatedSettings = { ...(current?.settings || {}), device_name: name };

        await supabase.from('device_settings').upsert([{ device_id, settings: updatedSettings }]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error renaming device:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// API для удаления устройства
app.delete('/api/device/:device_id/:token', async (req, res) => {
    const { device_id, token } = req.params;
    if (Buffer.from(token, 'base64').toString() !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        await supabase.from('locations').delete().eq('device_id', device_id);
        await supabase.from('device_settings').delete().eq('device_id', device_id);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting device:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// API для экспорта данных
app.get('/api/export/:device_id/:token', async (req, res) => {
    const { device_id, token } = req.params;
    if (Buffer.from(token, 'base64').toString() !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const { data: locations } = await supabase
            .from('locations')
            .select('*')
            .eq('device_id', device_id)
            .order('timestamp', { ascending: true });

        const { data: settings } = await supabase
            .from('device_settings')
            .select('*')
            .eq('device_id', device_id)
            .single();

        res.json({
            device_id,
            device_name: settings?.settings?.device_name,
            locations,
            exported_at: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error exporting data:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
    console.log(`Connected to Supabase`);
});
