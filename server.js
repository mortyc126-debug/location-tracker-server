// server.js
const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = 3000;

app.use(bodyParser.json());

// ===== DATABASE =====
const db = new sqlite3.Database('./agents.db');

// Создаем таблицы, если их нет
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT,
    token TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    device_name TEXT,
    battery INTEGER,
    last_seen TEXT,
    last_lat REAL,
    last_lng REAL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    latitude REAL,
    longitude REAL,
    timestamp TEXT
  )`);

  // Добавим тестового пользователя и устройства, если их нет
  db.get(`SELECT * FROM users WHERE username='agent007'`, (err, row) => {
    if(!row){
      db.run(`INSERT INTO users (username, password, token) VALUES (?, ?, ?)`,
        ['agent007', 'secret', uuidv4()]);
    }
  });

  db.get(`SELECT * FROM devices WHERE device_id='dev1'`, (err,row)=>{
    if(!row){
      const now = new Date().toISOString();
      db.run(`INSERT INTO devices (device_id, device_name, battery, last_seen, last_lat, last_lng)
              VALUES (?, ?, ?, ?, ?, ?)`,
        ['dev1','Tracker Alpha',100,now,54.6872,25.2797]);
    }
  });

  db.get(`SELECT * FROM devices WHERE device_id='dev2'`, (err,row)=>{
    if(!row){
      const now = new Date().toISOString();
      db.run(`INSERT INTO devices (device_id, device_name, battery, last_seen, last_lat, last_lng)
              VALUES (?, ?, ?, ?, ?, ?)`,
        ['dev2','Tracker Beta',80,now,55.0,26.0]);
    }
  });
});

// ===== AUTH =====
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username=? AND password=?`, [username,password], (err,row)=>{
    if(err) return res.status(500).json({error:err.message});
    if(!row) return res.status(401).json({success:false,error:'Invalid credentials'});
    const token = uuidv4();
    db.run(`UPDATE users SET token=? WHERE username=?`, [token, username]);
    res.json({success:true, token});
  });
});

// ===== MIDDLEWARE =====
function authMiddleware(req,res,next){
  const token = req.params.token || req.body.token;
  if(!token) return res.status(401).json({error:'No token'});
  db.get(`SELECT * FROM users WHERE token=?`, [token], (err,row)=>{
    if(err) return res.status(500).json({error:err.message});
    if(!row) return res.status(401).json({error:'Invalid token'});
    next();
  });
}

// ===== DEVICES =====
app.get('/api/devices/:token', authMiddleware, (req,res)=>{
  db.all(`SELECT * FROM devices`, [], (err, rows)=>{
    if(err) return res.status(500).json({error:err.message});
    const devicesList = rows.map(d=>({
      device_id: d.device_id,
      device_name: d.device_name,
      last_seen: d.last_seen,
      battery: d.battery,
      last_location: d.last_lat && d.last_lng ? {lat:d.last_lat,lng:d.last_lng} : null
    }));
    res.json(devicesList);
  });
});

// ===== DEVICE DATA =====
app.get('/api/device/:device_id/:token', authMiddleware, (req,res)=>{
  const device_id = req.params.device_id;
  db.get(`SELECT * FROM devices WHERE device_id=?`, [device_id], (err,d)=>{
    if(err) return res.status(500).json({error:err.message});
    if(!d) return res.status(404).json({error:'Device not found'});
    db.all(`SELECT latitude, longitude, timestamp FROM locations WHERE device_id=? ORDER BY timestamp`, [device_id], (err, locs)=>{
      if(err) return res.status(500).json({error:err.message});
      res.json({device_name:d.device_name, locations: locs});
    });
  });
});

// ===== HISTORY =====
app.get('/api/device/:device_id/history/:token', authMiddleware, (req,res)=>{
  const device_id = req.params.device_id;
  db.all(`SELECT latitude, longitude, timestamp FROM locations WHERE device_id=? ORDER BY timestamp`, [device_id], (err, locs)=>{
    if(err) return res.status(500).json({error:err.message});
    res.json({locations: locs});
  });
});

// ===== RENAME =====
app.post('/api/device/:device_id/rename', authMiddleware, (req,res)=>{
  const device_id = req.params.device_id;
  const { name } = req.body;
  db.run(`UPDATE devices SET device_name=? WHERE device_id=?`, [name, device_id], function(err){
    if(err) return res.status(500).json({error:err.message});
    res.json({success:true});
  });
});

// ===== DELETE =====
app.delete('/api/device/:device_id/:token', authMiddleware, (req,res)=>{
  const device_id = req.params.device_id;
  db.run(`DELETE FROM devices WHERE device_id=?`, [device_id], function(err){
    if(err) return res.status(500).json({error:err.message});
    db.run(`DELETE FROM locations WHERE device_id=?`, [device_id]);
    res.json({success:true});
  });
});

// ===== EXPORT =====
app.get('/api/export/:device_id/:token', authMiddleware, (req,res)=>{
  const device_id = req.params.device_id;
  db.get(`SELECT * FROM devices WHERE device_id=?`, [device_id], (err,d)=>{
    if(err) return res.status(500).json({error:err.message});
    if(!d) return res.status(404).json({error:'Device not found'});
    db.all(`SELECT latitude, longitude, timestamp FROM locations WHERE device_id=? ORDER BY timestamp`, [device_id], (err, locs)=>{
      if(err) return res.status(500).json({error:err.message});
      res.json({...d, locations: locs});
    });
  });
});

// ===== SIMULATE MOVEMENT =====
setInterval(()=>{
  db.all(`SELECT * FROM devices`, [], (err, devices)=>{
    if(err || !devices) return;
    devices.forEach(d=>{
      const lat = d.last_lat + (Math.random()-0.5)*0.01;
      const lng = d.last_lng + (Math.random()-0.5)*0.01;
      const timestamp = new Date().toISOString();
      db.run(`UPDATE devices SET last_lat=?, last_lng=?, last_seen=? WHERE device_id=?`, [lat,lng,timestamp,d.device_id]);
      db.run(`INSERT INTO locations (device_id, latitude, longitude, timestamp) VALUES (?,?,?,?)`, [d.device_id, lat, lng, timestamp]);
    });
  });
}, 5000);

app.listen(PORT, ()=>console.log(`Agent server running on http://localhost:${PORT}`));
