const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS || "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

// Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests, please try again later" }
});
app.use('/api/', limiter);

// API Routes
app.get('/api/status', (req, res) => {
  res.json({
    status: 'operational',
    timestamp: new Date(),
    environment: process.env.NODE_ENV
  });
});

app.get('/api/agents', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .order('timestamp', { ascending: false });

    if (error) throw error;
    
    // Convert data to agents format
    const agents = data.map(location => ({
      id: location.device_id,
      name: location.device_name,
      status: 'online',
      battery: location.battery,
      lastSeen: new Date(location.timestamp)
    }));

    res.json({ agents });
  } catch (error) {
    console.error('Error fetching agents:', error);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

app.post('/api/agents/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, battery } = req.body;

  try {
    const { error } = await supabase
      .from('locations')
      .update({
        status,
        battery,
        last_seen: new Date()
      })
      .eq('device_id', id);

    if (error) throw error;
    res.json({ message: 'Agent status updated', device_id: id });
  } catch (error) {
    console.error('Error updating agent status:', error);
    res.status(500).json({ error: 'Failed to update agent status' });
  }
});

// WebSocket Handling
io.on('connection', (socket) => {
  console.log('Client Connected:', socket.id);

  socket.on('join_device', async (deviceId) => {
    socket.join(`device_${deviceId}`);
    console.log(`Joined room: device_${deviceId}`);

    // Fetch device data
    const { data } = await supabase
      .from('locations')
      .select('*')
      .eq('device_id', deviceId)
      .limit(1);

    if (data && data.length > 0) {
      socket.emit('device_info', data[0]);
    }
  });

  socket.on('device_command', async (data) => {
    const { deviceId, action, payload } = data;
    console.log(`Command received from ${deviceId}: ${action}`);

    if (action === 'LOCATION_UPDATE') {
      try {
        const { error } = await supabase
          .from('locations')
          .insert([
            {
              device_id: deviceId,
              latitude: payload.latitude,
              longitude: payload.longitude,
              timestamp: payload.timestamp,
              accuracy: payload.accuracy,
              battery: payload.battery
            }
          ]);

        if (error) throw error;
        io.to(`device_${deviceId}`).emit('location_ack', payload);
      } catch (error) {
        console.error('Error processing location update:', error);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Client Disconnected');
  });
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Mission Control Server running on port ${PORT}`);
  console.log(`📊 Supabase URL: ${process.env.SUPABASE_URL}`);
});
