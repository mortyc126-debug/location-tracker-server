document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
    startRealTimeUpdates();
});

function initDashboard() {
    initMap();
    loadAgents();
    setupCharts();
}

function initMap() {
    const mapContainer = document.getElementById('map-container');
    mapContainer.innerHTML = `
        <div style="width: 100%; height: 100%; background: url('https://api.mapbox.com/styles/v1/mapbox/dark-v10/static/37.6173,55.7558,12,0/800x400?access_token=YOUR_TOKEN') center/cover; position: relative;">
            <div style="position: absolute; top: 20px; left: 20px; background: rgba(0,0,0,0.8); padding: 10px; border-radius: 8px;">
                <h4>Live Location Feed</h4>
                <p style="color: var(--accent-blue);">GPS Signal: Strong</p>
            </div>
        </div>
    `;
}

async function loadAgents() {
    try {
        const response = await fetch('/api/agents');
        const data = await response.json();
        
        const agentList = document.getElementById('agent-list');
        agentList.innerHTML = '';
        
        data.agents.forEach(agent => {
            const agentCard = document.createElement('div');
            agentCard.className = 'agent-item';
            agentCard.innerHTML = `
                <div>
                    <h4>${agent.name}</h4>
                    <p style="font-size: 0.9rem; color: var(--text-secondary);">${agent.deviceId}</p>
                </div>
                <div style="text-align: right;">
                    <span class="badge ${agent.status === 'online' ? 'online' : 'offline'}">${agent.status}</span>
                    <p style="font-size: 0.8rem; margin-top: 5px;">Battery: ${agent.battery}%</p>
                </div>
            `;
            agentList.appendChild(agentCard);
        });
    } catch (error) {
        console.error('Error loading agents:', error);
    }
}

function setupCharts() {
    const ctx = document.getElementById('healthChart').getContext('2d');
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'System Load (%)',
                data: [65, 59, 80, 81, 56, 55, 40],
                borderColor: '#d4af37',
                tension: 0.4,
                fill: true,
                backgroundColor: 'rgba(212, 175, 55, 0.1)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#ccc' } } },
            scales: {
                y: { ticks: { color: '#ccc' }, grid: { color: '#333' } },
                x: { ticks: { color: '#ccc' }, grid: { display: false } }
            }
        }
    });
}

function startRealTimeUpdates() {
    console.log('🔌 Real-time connection established');
    
    setInterval(() => {
        const now = new Date().toLocaleTimeString();
        document.getElementById('current-time').textContent = `Last Update: ${now}`;
    }, 5000);
}
