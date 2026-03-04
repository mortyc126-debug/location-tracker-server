-- ============================================================================
-- MISSION SPY DASHBOARD - DATA SEEDING SCRIPT
-- ============================================================================
-- Назначение: Заполнение таблицы locations начальными данными для демонстрации
-- функциональности шпионского приложения.
-- 
-- Совместимость: Создан на основе архитектуры Android LocationService и 
-- модели данных DeviceIdManager.
-- ============================================================================

-- ============================================
-- 1. Очистка существующих данных
-- ============================================

-- Удаление существующих записей (если требуется полная перезагрузка)
TRUNCATE TABLE locations RESTART IDENTITY CASCADE;

-- ============================================
-- 2. Вставка тестовых данных для нескольких устройств
-- ============================================

INSERT INTO locations (
    device_id, 
    device_name, 
    latitude, 
    longitude, 
    timestamp, 
    accuracy, 
    battery, 
    wifi_info,
    created_at
) VALUES
-- ================== АГЕНТ 1: ALPHA UNIT (Основное устройство) ==================
-- Данные с высоким уровнем батареи и точностью
(
    'AGT-ALPHA-001',
    'Alpha Unit',
    55.7558,
    37.6176,
    EXTRACT(EPOCH FROM NOW()) * 1000,
    10.5,
    95,
    '{"ssid": "AlphaSecureNet", "bssid": "00:11:22:33:44:55", "signal_strength": -45, "connected": true}',
    NOW()
),
(
    'AGT-ALPHA-001',
    'Alpha Unit',
    55.7568,
    37.6186,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL '1 hour')) * 1000,
    12.3,
    90,
    '{"ssid": "AlphaSecureNet", "bssid": "00:11:22:33:44:55", "signal_strength": -50, "connected": true}',
    NOW() - INTERVAL '1 hour'
),
(
    'AGT-ALPHA-001',
    'Alpha Unit',
    55.7578,
    37.6196,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL '2 hours')) * 1000,
    15.7,
    85,
    '{"ssid": "AlphaSecureNet", "bssid": "00:11:22:33:44:55", "signal_strength": -55, "connected": true}',
    NOW() - INTERVAL '2 hours'
),
(
    'AGT-ALPHA-001',
    'Alpha Unit',
    55.7588,
    37.6206,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL '3 hours')) * 1000,
    18.2,
    80,
    '{"ssid": "AlphaSecureNet", "bssid": "00:11:22:33:44:55", "signal_strength": -60, "connected": true}',
    NOW() - INTERVAL '3 hours'
),
(
    'AGT-ALPHA-001',
    'Alpha Unit',
    55.7598,
    37.6216,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL '4 hours')) * 1000,
    20.5,
    75,
    '{"ssid": "AlphaSecureNet", "bssid": "00:11:22:33:44:55", "signal_strength": -65, "connected":true}',
    NOW() - INTERVAL '4 hours'
),

-- ================== АГЕНТ 2: BETA UNIT (Подвижное устройство) ==================
-- Данные с умеренным уровнем батареи и периодическими изменениями
(
    'AGT-BETA-002',
    'Beta Unit',
    59.9343,
    30.3351,
    EXTRACT(EPOCH FROM NOW()) * 1000,
    14.8,
    78,
    '{"ssid": "BetaNetwork", "bssid": "AA:BB:CC:DD:EE:FF", "signal_strength": -52, "connected": true}',
    NOW()
),
(
    'AGT-BETA-002',
    'Beta Unit',
    59.9353,
    30.3361,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL '1 hour')) * 1000,
    16.5,
    75,
    '{"ssid": "BetaNetwork", "bssid": "AA:BB:CC:DD:EE:FF", "signal_strength": -55, "connected": true}',
    NOW() - INTERVAL '1 hour'
),
(
    'AGT-BETA-002',
    'Beta Unit',
    59.9363,
    30.3371,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL '2 hours')) * 1000,
    19.2,
    70,
    '{"ssid": "BetaNetwork", "bssid": "AA:BB:CC:DD:EE:FF", "signal_strength": -58, "connected": true}',
    NOW() - INTERVAL '2 hours'
),
(
    'AGT-BETA-002',
    'Beta Unit',
    59.9373,
    30.3381,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL '3 hours')) * 1000,
    22.6,
    65,
    '{"ssid": "BetaNetwork", "bssid": "AA:BB:CC:DD:EE:FF", "signal_strength": -62, "connected': true}',
    NOW() - INTERVAL '3 hours'
),

-- ================== АГЕНТ 3: GAMMA UNIT (Фоновый агент) ==================
-- Данные с низким уровнем батареи и редкими обновлениями
(
    'AGT-GAMMA-003',
    'Gamma Unit',
    51.5074,
    -0.1278,
    EXTRACT(EPOCH FROM NOW()) * 1000,
    25.4,
    62,
    '{"ssid": "GammaConnect", "bssid": "11:22:33:44:55:66", "signal_strength": -68, "connected': true}',
    NOW()
),
(
    'AGT-GAMMA-003',
    'Gamma Unit',
    51.5084,
    -0.1268,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL '2 hours')) * 1000,
    28.7,
    58,
    '{"ssid": "GammaConnect", "bssid': '11:22:33:44:55:66', 'signal_strength': -72, 'connected': true}',
    NOW() - INTERVAL '2 hours'
),
(
    'AGT-GAMMA-003',
    'Gamma Unit',
    51.5094,
    -0.1258,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL '4 hours')) * 1000,
    32.1,
    54,
    '{"ssid': 'GammaConnect', 'bssid': '11:22:33:44:55:66', 'signal_strength': -75, 'connected': true}',
    NOW() - INTERVAL '4 hours'
),
(
    'AGT-GAMMA-003',
    'Gamma Unit',
    51.5104,
    -0.1248,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL'6 hours')) * 1000,
    35.8,
    50,
    '{"ssid': 'GammaConnect', 'bssid': '11:22:33:44:55:66', 'signal_strength': -78, 'connected':true}',
    NOW() - INTERVAL '6 hours'
),

-- ================== АГЕНТ 4: DELTA UNIT (Мобильная камера) ==================
-- Данные с высокой точностью и частыми обновлениями
(
    'AGT-DELTA-004',
    'Delta Camera',
    40.7128,
    -74.0060,
    EXTRACT(EPOCH FROM NOW()) * 1000,
    8.2,
    88,
    '{"ssid': 'DeltaCamNetwork', 'bssid': 'FF:EE:DD:CC:BB:AA', 'signal_strength': -42, 'connected':true}',
    NOW()
),
(
    'AGT-DELTA-004',
    'Delta Camera',
    40.7138,
    -74.0070,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL'30 minutes')) * 1000,
    9.5,
    86,
    '{"ssid': 'DeltaCamNetwork', 'bssid': 'FF:EE:DD:CC:BB:AA', 'signal_strength': -45, 'connected':true}',
    NOW() - INTERVAL'30 minutes'
),
(
    'AGT-DELTA-004',
    'Delta Camera',
    40.7148,
    -74.0080,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL'1 hour')) * 1000,
    11.3,
    84,
    '{"ssid': 'DeltaCamNetwork', 'bssid': 'FF:EE:DD:CC:BB:AA', 'signal_strength': -48, 'connected':true}',
    NOW() - INTERVAL'1 hour'
),
(
    'AGT-DELTA-004',
    'Delta Camera',
    40.7158,
    -74.0090,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL'1 hour 30 minutes')) * 1000,
    13.7,
    82,
    '{"ssid': 'DeltaCamNetwork', 'bssid': 'FF:EE:DD:CC:BB:AA', 'signal_strength': -50, 'connected':true}',
    NOW() - INTERVAL'1 hour 30 minutes'
),

-- ================== АГЕНТ 5: EPSILON UNIT (Сетевой монитор) ==================
-- Данные с постоянным мониторингом и высокой доступностью
(
    'AGT-EPSILON-005',
    'Epsilon Network',
    35.6762,
    139.6503,
    EXTRACT(EPOCH FROM NOW()) * 1000,
    12.9,
    92,
    '{"ssid': 'EpsilonMonitor', 'bssid': '99:88:77:66:55:44', 'signal_strength': -40, 'connected':true}',
    NOW()
),
(
    'AGT-EPSILON-005',
    'Epsilon Network',
    35.6772,
    139.6513,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL'45 minutes')) * 1000,
    14.6,
    90,
    '{"ssid': 'EpsilonMonitor', 'bssid': '99:88:77:66:55:44', 'signal_strength': -43, 'connected':true}',
    NOW() - INTERVAL'45 minutes'
),
(
    'AGT-EPSILON-005',
    'Epsilon Network',
    35.6782,
    139.6523,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL'1hour 15minutes')) * 1000,
    16.8,
    88,
    '{"ssid': 'EpsilonMonitor', 'bssid': '99:88:77:66:55:44', 'signal_strength': -46, 'connected':true}',
    NOW() - INTERVAL'1hour 15minutes'
),
(
    'AGT-EPSILON-005',
    'Epsilon Network',
    35.6792,
    139.6533,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL'1hour 45minutes')) * 1000,
    19.4,
    86,
    '{"ssid': 'EpsilonMonitor', 'bssid': '99:88:77:66:55:44', 'signal_strength': -49, 'connected':true}',
    NOW() - INTERVAL'1hour 45minutes'
)

-- Добавление дополнительных записей для имитации исторических данных
UNION ALL
SELECT 
    'AGT-HISTORICAL-001',
    'Historical Agent',
    52.5200,
    13.4050,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL'7 days')) * 1000,
    22.5,
    70,
    '{"ssid': 'HistoricalNet', 'bssid': 'DE:AD:BE:EF:00:00', 'signal_strength': -60, 'connected':true}',
    NOW() - INTERVAL'7 days'
UNION ALL
SELECT 
    'AGT-HISTORICAL-002',
    'Historical Agent',
    48.8566,
    2.3522,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL'14 days')) * 1000,
    25.8,
    65,
    '{"ssid': 'HistoricalNet', 'bssid': 'DE:AD:BE:EF:11:11', 'signal_strength': -65, 'connected':true}',
    NOW() - INTERVAL'14 days'
UNION ALL
SELECT 
    'AGT-HISTORICAL-003',
    'Historical Agent',
    40.4168,
    -3.7038,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL'21 days')) * 1000,
    28.3,
    60,
    '{"ssid': 'HistoricalNet', 'bssid': 'DE:AD:BE:EF:22:22', 'signal_strength': -70, 'connected':true}',
    NOW() - INTERVAL'21 days'

-- Заполнение таблицы данными за последний месяц
UNION ALL
SELECT 
    'AGT-MONTHLY-001',
    'Monthly Reporter',
    34.0522,
    -117.1972,
    EXTRACT(EPOCH FROM (NOW() - INTERVAL'30 days')) * 1000,
    30.6,
    55,
    '{"ssid': 'MonthlyNet', 'bssid': 'CA:FE:00:00:00:00', 'signal_strength': -75, 'connected':true}',
    NOW() - INTERVAL'30 days'
;

-- ============================================
-- 3. Создание и заполнение дополнительных таблиц (опционально)
-- ============================================

-- Создание таблицы для хранения событий устройств
CREATE TABLE IF NOT EXISTS device_events (
    id          BIGSERIAL PRIMARY KEY,
    device_id   TEXT        NOT NULL,
    event_type  TEXT        NOT NULL,
    event_data  JSONB       NOT NULL,
    timestamp   TIMESTAMPTZ DEFAULT NOW(),
    severity    TEXT        DEFAULT 'INFO',
    FOREIGN KEY (device_id) REFERENCES locations(device_id)
);

-- Создание индексов для таблицы событий
CREATE INDEX IF NOT EXISTS idx_device_events_device_id 
    ON device_events (device_id);
CREATE INDEX IF NOT EXISTS idx_device_events_event_type 
    ON device_events (event_type);
CREATE INDEX IF NOT EXISTS idx_device_events_timestamp 
    ON device_events (timestamp DESC);

-- Вставка тестовых событий
INSERT INTO device_events (device_id, event_type, event_data, severity) VALUES
    ('AGT-ALPHA-001', 'LOCATION_UPDATE', '{"latitude": 55.7558, "longitude": 37.6176, "accuracy": 10.5}', 'INFO'),
    ('AGT-ALPHA-001', 'BATTERY_LOW', '{"level": 20, "threshold": 15}', 'WARNING'),
    ('AGT-BETA-002', 'NETWORK_CHANGE', '{"from": "WiFi", "to": "Cellular"}', 'INFO'),
    ('AGT-GAMMA-003', 'SYSTEM_MAINTENANCE', '{"last_maintenance": "2024-01-01", "next_maintenance": "2024-04-01"}', 'INFO'),
    ('AGT-DELTA-004', 'CAMERA_ACTIVATION', '{"camera_id": "DELTA-CAM-001", "status": "active"}', 'INFO'),
    ('AGT-EPSILON-005', 'SECURITY_SCAN', '{"scan_type": "full", "threats_detected": 0}', 'SUCCESS')
ON CONFLICT (device_id, event_type) DO NOTHING;

-- ============================================
-- 4. Обновление статистики и метрик
-- ============================================

-- Создание представления для агрегированных данных
CREATE OR REPLACE VIEW agent_statistics AS
SELECT 
    device_id,
    device_name,
    COUNT(*) AS total_records,
    MIN(timestamp) AS first_record,
    MAX(timestamp) AS last_record,
    AVG(accuracy) AS avg_accuracy,
    AVG(battery) AS avg_battery,
    MIN(battery) AS min_battery,
    MAX(battery) AS max_battery,
    AVG(latitude) AS avg_latitude,
    AVG(longitude) AS avg_longitude
FROM locations
GROUP BY device_id, device_name
ORDER BY last_record DESC;

-- ============================================
-- 5. Подтверждение успешного выполнения
-- ============================================

-- Вывод информации о заполненных данных
DO $$
DECLARE
    total_records INTEGER;
    total_agents INTEGER;
    total_events INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_records FROM locations;
    SELECT COUNT(DISTINCT device_id) INTO total_agents FROM locations;
    SELECT COUNT(*) INTO total_events FROM device_events;
    
    RAISE NOTICE '=== Data Seeding Complete ===';
    RAISE NOTICE 'Total Location Records: %', total_records;
    RAISE NOTICE 'Total Active Agents: %', total_agents;
    RAISE NOTICE 'Total Device Events: %', total_events;
    RAISE NOTICE 'Database ready for Mission Control Dashboard!';
END $$;
