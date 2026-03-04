const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const path = require('path');
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
app.use(express.static(path.join(__dirname, '../../public')));

// Supabase Client (пример)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// API Routes
app.get('/api/status', (req, res) => {
  res.json({
    status: 'operational',
    timestamp: new Date(),
    environment: process.env.NODE_ENV
  });
});

// WebSocket Handling
io.on('connection', (socket) => {
  console.log('Client Connected:', socket.id);
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
