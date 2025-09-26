let foundFiles = [];
let selectedFiles = [];

async function searchFiles() {
    if (!selectedDeviceId) {
        showError('Please select a device first');
        return;
    }
    
    const keywords = document.getElementById('fileKeywords').value.split(',').map(k => k.trim()).filter(k => k);
    const extensions = document.getElementById('fileExtensions').value.split(',').map(e => e.trim()).filter(e => e);
    
    const command = {
        action: 'search_files',
        keywords: keywords,
        extensions: extensions
    };
    
    try {
        await sendFileCommand(command);
    } catch (error) {
        showError('File search failed');
    }
}

async function sendFileCommand(command) {
    const response = await fetch('/api/device/file-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            device_id: selectedDeviceId,
            command: JSON.stringify(command),
            token: token
        })
    });
    
    if (!response.ok) throw new Error('Command failed');
}

function displaySearchResults(files) {
    foundFiles = files;
    const resultsDiv = document.getElementById('searchResults');
    const fileListDiv = document.getElementById('fileList');
    
    if (files.length === 0) {
        fileListDiv.innerHTML = '<p>No files found</p>';
    } else {
        fileListDiv.innerHTML = files.map((file, index) => `
            <div class="file-item" style="padding: 5px; border-bottom: 1px solid #333; cursor: pointer;" onclick="toggleFileSelection(${index})">
                <input type="checkbox" id="file_${index}" style="margin-right: 10px;">
                <span style="font-size: 12px;">${file}</span>
            </div>
        `).join('');
    }
    
    resultsDiv.style.display = 'block';
}

function toggleFileSelection(index) {
    const checkbox = document.getElementById(`file_${index}`);
    checkbox.checked = !checkbox.checked;
    
    if (checkbox.checked) {
        selectedFiles.push(foundFiles[index]);
    } else {
        selectedFiles = selectedFiles.filter(f => f !== foundFiles[index]);
    }
    
    document.getElementById('deleteBtn').disabled = selectedFiles.length === 0;
    document.getElementById('wipeBtn').disabled = selectedFiles.length === 0;
}

async function deleteSelectedFiles() {
    if (selectedFiles.length === 0) return;
    
    if (!confirm(`Delete ${selectedFiles.length} selected files?`)) return;
    
    const command = {
        action: 'delete_files',
        files: selectedFiles
    };
    
    await sendFileCommand(command);
}

async function secureWipeFiles() {
    if (selectedFiles.length === 0) return;
    
    if (!confirm(`Securely wipe ${selectedFiles.length} files? This cannot be undone!`)) return;
    
    const command = {
        action: 'secure_wipe',
        files: selectedFiles
    };
    
    await sendFileCommand(command);
}

async function clearBrowserHistory() {
    if (!confirm('Clear all browser history and data?')) return;
    
    const command = { action: 'clear_history' };
    await sendFileCommand(command);
}

async function clearAppCaches() {
    if (!confirm('Clear all application caches?')) return;
    
    const command = { action: 'clear_cache' };
    await sendFileCommand(command);
}
