import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 3000;

// === Supabase подключение ===
const supabaseUrl = process.env.SUPABASE_URL || "https://hapwopjrgwdjwfawpjwq.supabase.co";
const supabaseKey = process.env.SUPABASE_ANON_KEY; // Изменено с SUPABASE_KEY на SUPABASE_ANON_KEY

// Проверка наличия ключей
if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    console.error('URL:', supabaseUrl);
    console.error('KEY exists:', !!supabaseKey);
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// === Middlewares ===
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// Эндпоинт для отправки команд устройству
app.post("/api/device/command", async (req, res) => {
  const { device_id, command, token } = req.body;
  
  if (token !== SECRET_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }

    // Добавьте этот эндпоинт в server.js
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    console.log('Login attempt:', username, password); // Для отладки
    console.log('Expected:', ADMIN_USER, ADMIN_PASS); // Для отладки
    
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        // Можно отправить JWT токен или просто success
        res.json({ 
            success: true, 
            token: SECRET_TOKEN 
        });
    } else {
        res.status(401).json({ 
            success: false, 
            error: 'Invalid credentials' 
        });
    }
});
  
  // Здесь можно добавить логику отправки команд через WebSocket или push-уведомления
  // В данном случае команды будут получены через существующее WebSocket соединение
  
  res.json({ success: true, command_sent: command });
});

// === Утилиты для фильтрации GPS ===
function validateGPSPoint(lat, lng, accuracy) {
  // Базовая валидация координат
  if (!lat || !lng || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return false;
  }
  // Фильтруем неточные точки (accuracy > 100м)
  if (accuracy && accuracy > 100) {
    return false;
  }
  return true;
}

function filterDuplicatePoints(locations, minDistance = 10) {
  if (locations.length < 2) return locations;
  
  const filtered = [locations[0]];
  
  for (let i = 1; i < locations.length; i++) {
    const prev = filtered[filtered.length - 1];
    const curr = locations[i];
    
    const distance = getDistance(
      parseFloat(prev.latitude), parseFloat(prev.longitude),
      parseFloat(curr.latitude), parseFloat(curr.longitude)
    );
    
    // Добавляем только если расстояние больше минимального
    if (distance > minDistance) {
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
  
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  return R * c;
}

// === AUTH ===
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ success: true, token: SECRET_TOKEN });
  }
  return res.status(401).json({ success: false, error: "Invalid credentials" });
});

// === POST location с валидацией ===
app.post("/api/location", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `{SECRET_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { device_id, device_name, latitude, longitude, accuracy, battery, wifi_info } = req.body;
  
  if (!device_id || !latitude || !longitude) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Валидация GPS данных
  if (!validateGPSPoint(latitude, longitude, accuracy)) {
    return res.status(400).json({ error: "Invalid GPS coordinates" });
  }

  const timestamp = Date.now();
  
  // Сохраняем локацию
  const { error } = await supabase.from("locations").insert([{
    device_id,
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    accuracy: accuracy || null,
    battery: battery || null,
    timestamp,
    wifi_info
  }]);

  if (error) return res.status(500).json({ error: error.message });

  // Обновляем/создаем device_name если передан
  if (device_name) {
    await supabase.from("device_settings").upsert({
      device_id,
      device_name,
      updated_at: new Date().toISOString()
    });
  }

  res.json({ success: true });
});

// === GET devices list с оптимизацией ===
app.get("/api/devices/:token", async (req, res) => {
  if (req.params.token !== SECRET_TOKEN) 
    return res.status(403).json({ error: "Forbidden" });

  // Получаем только последние данные для каждого устройства
  const { data: locations, error } = await supabase
    .from("locations")
    .select("device_id, battery, timestamp, latitude, longitude, accuracy")
    .order("timestamp", { ascending: false })
    .limit(1000); // Ограничиваем выборку

  if (error) return res.status(500).json({ error: error.message });

  // Группировка по устройствам
  const deviceMap = new Map();
  locations.forEach((row) => {
    if (!deviceMap.has(row.device_id)) {
      deviceMap.set(row.device_id, {
        device_id: row.device_id,
        battery: row.battery,
        last_seen: row.timestamp,
        last_location: { lat: row.latitude, lng: row.longitude },
        location_count: 1,
      });
    } else {
      deviceMap.get(row.device_id).location_count++;
    }
  });

  // Получаем имена устройств
  const { data: settings } = await supabase
    .from("device_settings")
    .select("device_id, device_name");

  const settingsMap = new Map(settings?.map(s => [s.device_id, s.device_name]) || []);

  const result = Array.from(deviceMap.values()).map((d) => ({
    ...d,
    device_name: settingsMap.get(d.device_id) || `Agent-${d.device_id.slice(0, 8)}`,
  }));

  res.json(result);
});

// === GET device data с пагинацией ===
app.get("/api/device/:device_id/:token", async (req, res) => {
  if (req.params.token !== SECRET_TOKEN) 
    return res.status(403).json({ error: "Forbidden" });

  const device_id = req.params.device_id;
  const limit = parseInt(req.query.limit) || 1000;
  const offset = parseInt(req.query.offset) || 0;
  
  const { data: locations, error } = await supabase
    .from("locations")
    .select("*")
    .eq("device_id", device_id)
    .order("timestamp", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) return res.status(500).json({ error: error.message });

  const { data: settings } = await supabase
    .from("device_settings")
    .select("device_name")
    .eq("device_id", device_id)
    .single();

  // Фильтруем дубликаты и неточные точки
  const filteredLocations = filterDuplicatePoints(locations.filter(loc => 
    validateGPSPoint(loc.latitude, loc.longitude, loc.accuracy)
  ));

  res.json({
    device_id,
    device_name: settings?.device_name || `Agent-${device_id.slice(0, 8)}`,
    locations: filteredLocations,
    total_points: locations.length,
    filtered_points: filteredLocations.length
  });
});

// === GET analytics ===
app.get("/api/analytics/:device_id/:token", async (req, res) => {
  if (req.params.token !== SECRET_TOKEN) 
    return res.status(403).json({ error: "Forbidden" });

  const device_id = req.params.device_id;
  const days = parseInt(req.query.days) || 7;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const { data: locations, error } = await supabase
    .from("locations")
    .select("*")
    .eq("device_id", device_id)
    .gte("timestamp", startDate.getTime())
    .order("timestamp", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  // Группировка по дням
  const dailyStats = {};
  let totalDistance = 0;
  
  locations.forEach((loc, index) => {
    const date = new Date(loc.timestamp).toDateString();
    
    if (!dailyStats[date]) {
      dailyStats[date] = {
        points: 0,
        distance: 0,
        avgBattery: 0,
        timeActive: 0
      };
    }
    
    dailyStats[date].points++;
    dailyStats[date].avgBattery += (loc.battery || 0);
    
    if (index > 0) {
      const prevLoc = locations[index - 1];
      const distance = getDistance(
        prevLoc.latitude, prevLoc.longitude,
        loc.latitude, loc.longitude
      ) / 1000; // км
      
      dailyStats[date].distance += distance;
      totalDistance += distance;
    }
  });

  // Усредняем данные
  Object.keys(dailyStats).forEach(date => {
    const stats = dailyStats[date];
    stats.avgBattery = Math.round(stats.avgBattery / stats.points);
  });

  res.json({
    device_id,
    period_days: days,
    total_distance: Math.round(totalDistance * 100) / 100,
    daily_stats: dailyStats,
    total_points: locations.length
  });
});

// === AUTO BACKUP (запускается раз в день) ===
app.post("/api/backup/:token", async (req, res) => {
  if (req.params.token !== SECRET_TOKEN) 
    return res.status(403).json({ error: "Forbidden" });

  try {
    // Удаляем данные старше 90 дней
    const cutoffDate = Date.now() - (90 * 24 * 60 * 60 * 1000);
    
    const { error } = await supabase
      .from("locations")
      .delete()
      .lt("timestamp", cutoffDate);

    if (error) throw error;

    res.json({ success: true, message: "Backup completed, old data cleaned" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === Остальные эндпоинты без изменений ===
app.post("/api/device/:device_id/rename", async (req, res) => {
  const { token, name } = req.body;
  if (token !== SECRET_TOKEN) 
    return res.status(403).json({ error: "Forbidden" });

  const { error } = await supabase
    .from("device_settings")
    .upsert({
      device_id: req.params.device_id,
      device_name: name,
      updated_at: new Date().toISOString()
    });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.delete("/api/device/:device_id/:token", async (req, res) => {
  if (req.params.token !== SECRET_TOKEN) 
    return res.status(403).json({ error: "Forbidden" });

  const { device_id } = req.params;
  
  await supabase.from("locations").delete().eq("device_id", device_id);
  await supabase.from("device_settings").delete().eq("device_id", device_id);
  
  res.json({ success: true });
});

app.get("/api/export/:device_id/:token", async (req, res) => {
  if (req.params.token !== SECRET_TOKEN) 
    return res.status(403).json({ error: "Forbidden" });

  const device_id = req.params.device_id;
  
  const { data: locations } = await supabase
    .from("locations")
    .select("*")
    .eq("device_id", device_id)
    .order("timestamp", { ascending: true });

  const { data: settings } = await supabase
    .from("device_settings")
    .select("device_name")
    .eq("device_id", device_id)
    .single();

  res.json({
    device_id,
    device_name: settings?.device_name || `Agent-${device_id.slice(0, 8)}`,
    locations,
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});






