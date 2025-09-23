import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 3000;

// === Supabase подключение ===
const supabaseUrl = "https://hapwopjrgwdjwfawpjwq.supabase.co";
const supabaseKey = process.env.SUPABASE_KEY; // ключ хранится в Render
const supabase = createClient(supabaseUrl, supabaseKey);

// === Конфиг авторизации ===
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin";
const SECRET_TOKEN = process.env.SECRET_TOKEN || "your_secret_key_123";

// === Middlewares ===
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// === AUTH ===
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ success: true, token: SECRET_TOKEN });
  }
  return res.status(401).json({ success: false, error: "Invalid credentials" });
});

// === POST location ===
app.post("/api/location", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${SECRET_TOKEN}`) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { device_id, device_name, latitude, longitude, accuracy, battery } = req.body;
  if (!device_id || !latitude || !longitude) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const timestamp = Date.now();

  const { error } = await supabase.from("locations").insert([
    {
      device_id,
      latitude,
      longitude,
      accuracy,
      battery,
      timestamp,
    },
  ]);

  if (error) return res.status(500).json({ error: error.message });

  // сохраняем настройки если новое устройство
  const { data: exists } = await supabase
    .from("device_settings")
    .select("*")
    .eq("device_id", device_id)
    .maybeSingle();

  if (!exists) {
    await supabase.from("device_settings").insert([
      { device_id, settings: { name: device_name || device_id } },
    ]);
  }

  res.json({ success: true });
});

// === GET devices list ===
app.get("/api/devices/:token", async (req, res) => {
  if (req.params.token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });

  const { data: devices, error } = await supabase
    .from("locations")
    .select(
      "device_id, battery, timestamp, latitude, longitude, accuracy"
    )
    .order("timestamp", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // группировка по устройствам
  const map = new Map();
  devices.forEach((row) => {
    if (!map.has(row.device_id)) {
      map.set(row.device_id, {
        device_id: row.device_id,
        battery: row.battery,
        last_seen: row.timestamp,
        last_location: { lat: row.latitude, lng: row.longitude },
        location_count: 1,
      });
    } else {
      map.get(row.device_id).location_count++;
    }
  });

  // имена из device_settings
  const { data: settings } = await supabase.from("device_settings").select("*");
  const settingsMap = new Map(settings.map((s) => [s.device_id, s.settings.name]));

  const result = Array.from(map.values()).map((d) => ({
    ...d,
    device_name: settingsMap.get(d.device_id) || d.device_id,
  }));

  res.json(result);
});

// === GET device full data ===
app.get("/api/device/:device_id/:token", async (req, res) => {
  if (req.params.token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });

  const device_id = req.params.device_id;

  const { data: locations, error } = await supabase
    .from("locations")
    .select("*")
    .eq("device_id", device_id)
    .order("timestamp", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const { data: settings } = await supabase
    .from("device_settings")
    .select("settings")
    .eq("device_id", device_id)
    .maybeSingle();

  res.json({
    device_id,
    device_name: settings?.settings?.name || device_id,
    locations,
  });
});

// === GET device history ===
app.get("/api/device/:device_id/history/:token", async (req, res) => {
  if (req.params.token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });

  const { device_id } = req.params;

  const { data: locations, error } = await supabase
    .from("locations")
    .select("*")
    .eq("device_id", device_id)
    .order("timestamp", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  res.json({ device_id, locations });
});

// === RENAME device ===
app.post("/api/device/:device_id/rename", async (req, res) => {
  const { token, name } = req.body;
  if (token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });

  const { error } = await supabase
    .from("device_settings")
    .upsert({ device_id: req.params.device_id, settings: { name } });

  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true });
});

// === DELETE device ===
app.delete("/api/device/:device_id/:token", async (req, res) => {
  if (req.params.token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });

  const { device_id } = req.params;

  await supabase.from("locations").delete().eq("device_id", device_id);
  await supabase.from("device_settings").delete().eq("device_id", device_id);

  res.json({ success: true });
});

// === EXPORT device data ===
app.get("/api/export/:device_id/:token", async (req, res) => {
  if (req.params.token !== SECRET_TOKEN) return res.status(403).json({ error: "Forbidden" });

  const device_id = req.params.device_id;

  const { data: locations } = await supabase
    .from("locations")
    .select("*")
    .eq("device_id", device_id)
    .order("timestamp", { ascending: true });

  const { data: settings } = await supabase
    .from("device_settings")
    .select("settings")
    .eq("device_id", device_id)
    .maybeSingle();

  res.json({
    device_id,
    device_name: settings?.settings?.name || device_id,
    locations,
  });
});

// === Start server ===
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
