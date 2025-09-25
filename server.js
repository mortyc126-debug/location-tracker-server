const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'))); // для фронтенда

// === DB SETUP ===
const db = new sqlite3.Database('./tracker.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    device_name TEXT,
    owner TEXT,
    FOREIGN KEY(owner) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    device_id TEXT,
    latitude REAL,
    longitude REAL,
    battery INTEGER,
    timestamp INTEGER,
    FOREIGN KEY(device_id) REFERENCES devices(device_id)
  )`);
});

// === AUTH ===
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, row) => {
    if (err) return res.status(500).json({ success: false, error: 'DB error' });
    if (!row) return res.json({ success: false, error: 'Invalid credentials' });
    const token = uuidv4(); // простой токен
    res.json({ success: true, token, userId: row.id });
  });
});

// === DEVICES ===
app.get('/api/devices/:token', (req, res) => {
  const token = req.params.token;
  // Для упрощения не проверяем токен, но можно добавить проверку
  db.all(`SELECT * FROM devices`, [], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.get('/api/device/:deviceId/:token', (req, res) => {
  const { deviceId } = req.params;
  db.get(`SELECT * FROM devices WHERE device_id = ?`, [deviceId], (err, device) => {
    if (err || !device) return res.status(404).json({ error: 'Device not found' });
    db.all(`SELECT * FROM locations WHERE device_id = ? ORDER BY timestamp ASC`, [deviceId], (err, locations) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ ...device, locations });
    });
  });
});

// === HISTORY ===
app.get('/api/device/:deviceId/history/:token', (req, res) => {
  const { deviceId } = req.params;
  db.all(`SELECT * FROM locations WHERE device_id = ? ORDER BY timestamp ASC`, [deviceId], (err, locations) => {
    if (err) return res.status(500).json([]);
    res.json({ locations });
  });
});

// === RENAME DEVICE ===
app.post('/api/device/:deviceId/rename', (req, res) => {
  const { deviceId } = req.params;
  const { name } = req.body;
  db.run(`UPDATE devices SET device_name = ? WHERE device_id = ?`, [name, deviceId], function(err) {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true });
  });
});

// === DELETE DEVICE ===
app.delete('/api/device/:deviceId/:token', (req, res) => {
  const { deviceId } = req.params;
  db.run(`DELETE FROM devices WHERE device_id = ?`, [deviceId], function(err) {
    if (err) return res.status(500).json({ success: false });
    db.run(`DELETE FROM locations WHERE device_id = ?`, [deviceId]);
    res.json({ success: true });
  });
});

// === EXPORT DATA ===
app.get('/api/export/:deviceId/:token', (req, res) => {
  const { deviceId } = req.params;
  db.get(`SELECT * FROM devices WHERE device_id = ?`, [deviceId], (err, device) => {
    if (err || !device) return res.status(404).json({ error: 'Device not found' });
    db.all(`SELECT * FROM locations WHERE device_id = ? ORDER BY timestamp ASC`, [deviceId], (err, locations) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ ...device, locations });
    });
  });
});

// === ADD LOCATION (от агента) ===
app.post('/api/device/:deviceId/location', (req, res) => {
  const { deviceId } = req.params;
  const { latitude, longitude, battery } = req.body;
  const timestamp = Date.now();
  const id = uuidv4();
  db.run(
    `INSERT INTO locations (id, device_id, latitude, longitude, battery, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, deviceId, latitude, longitude, battery, timestamp],
    (err) => {
      if (err) return res.status(500).json({ success: false });
      res.json({ success: true });
    }
  );
});

// === CREATE DEVICE (для теста) ===
app.post('/api/device/create', (req, res) => {
  const { device_name } = req.body;
  const device_id = uuidv4();
  db.run(`INSERT INTO devices (device_id, device_name) VALUES (?, ?)`, [device_id, device_name], (err) => {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true, device_id, device_name });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
