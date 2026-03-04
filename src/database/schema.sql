-- Создание таблицы locations
CREATE TABLE locations (
  id          BIGSERIAL PRIMARY KEY,
  device_id   TEXT        NOT NULL,
  device_name TEXT        NOT NULL DEFAULT 'Unknown Device',
  latitude    FLOAT       NOT NULL,
  longitude   FLOAT       NOT NULL,
  timestamp   BIGINT      NOT NULL,
  accuracy    FLOAT,
  battery     INTEGER,
  wifi_info   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы для быстрых запросов
CREATE INDEX idx_locations_device_id   ON locations (device_id);
CREATE INDEX idx_locations_timestamp   ON locations (timestamp DESC);
CREATE INDEX idx_locations_device_time ON locations (device_id, timestamp DESC);

-- Разрешить все операции через anon key
CREATE POLICY "Allow all for anon"
  ON locations
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- Вставка тестовых данных
INSERT INTO locations (device_id, device_name, latitude, longitude, timestamp, accuracy, battery, wifi_info)
VALUES
  ('DEV-001', 'Alpha Unit', 55.7558, 37.6176, EXTRACT(EPOCH FROM NOW()) * 1000, 10.5, 85, '{"ssid": "AlphaWiFi", "bssid": "00:11:22:33:44:55"}'),
  ('DEV-002', 'Beta Unit', 59.9343, 30.3351, EXTRACT(EPOCH FROM NOW()) * 1000, 15.2, 72, '{"ssid": "BetaNetwork", "bssid": "AA:BB:CC:DD:EE:FF"}'),
  ('DEV-003', 'Gamma Unit', 51.5074, -0.1278, EXTRACT(EPOCH FROM NOW()) * 1000, 8.7, 68, '{"ssid": "GammaConnect", "bssid": "11:22:33:44:55:66"}');
