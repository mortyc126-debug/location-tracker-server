// Переменные файлового менеджера
let currentDirectory = '';
let fileList = [];
let selectedFile = null;
let breadcrumbPath = [];

// Подключение к файловой системе устройства
function connectToFileSystem() {
    if (!selectedDeviceId) {
        showError('Please select a device first');
        return;
    }
    
    // Запрашиваем корневую директорию
    sendFileSystemCommand({ action: 'list_directory', path: '' });
}

function sendFileSystemCommand(command) {
    if (liveStreamWebSocket && liveStreamWebSocket.readyState === WebSocket.OPEN) {
        liveStreamWebSocket.send(JSON.stringify(command));
    } else {
        showError('Connection to device not established');
    }
}

// Обработка WebSocket сообщений (добавить в существующий обработчик)
function handleFileSystemMessage(data) {
    switch (data.type) {
        case 'directory_listing':
            displayDirectoryListing(data);
            break;
        case 'file_content':
            displayFileContent(data);
            break;
        case 'search_results':
            displaySearchResults(data);
            break;
        case 'delete_result':
            handleDeleteResult(data);
            break;
        default:
            console.log('Unknown file system message:', data);
    }
}

function displayDirectoryListing(data) {
    if (data.error) {
        showError('Directory access failed: ' + data.error);
        return;
    }
    
    currentDirectory = data.currentPath;
    document.getElementById('currentPath').textContent = currentDirectory;
    document.getElementById('upBtn').disabled = !data.parentPath;
    
    const fileListElement = document.getElementById('fileList');
    fileListElement.innerHTML = '';
    
    fileList = [];
    
    // Добавляем папки
    if (data.folders) {
        data.folders.forEach(folder => {
            fileList.push(folder);
            fileListElement.appendChild(createFileElement(folder));
        });
    }
    
    // Добавляем файлы
    if (data.files) {
        data.files.forEach(file => {
            fileList.push(file);
            fileListElement.appendChild(createFileElement(file));
        });
    }
    
    if (fileList.length === 0) {
        fileListElement.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">Directory is empty</div>';
    }
}

function createFileElement(item) {
    const element = document.createElement('div');
    element.className = 'file-item';
    element.onclick = () => selectFileItem(item, element);
    element.ondblclick = () => {
        if (item.type === 'directory') {
            navigateToDirectory(item.path);
        } else {
            previewFile(item);
        }
    };
    
    const icon = getFileIcon(item);
    const itemClass = getFileClass(item);
    
    element.innerHTML = `
        <div class="file-icon">${icon}</div>
        <div class="file-info">
            <div class="file-name ${itemClass}">${item.name}</div>
            <div class="file-meta">
                ${item.type === 'directory' ? `${item.itemCount || 0} items` : item.sizeFormatted || ''}
                <br>
                <span style="font-size: 10px;">${item.lastModified}</span>
            </div>
        </div>
    `;
    
    return element;
}

function getFileIcon(item) {
    if (item.type === 'directory') return '📁';
    if (item.isImage) return '🖼️';
    if (item.isVideo) return '🎬';
    if (item.isDocument) return '📄';
    
    const ext = item.extension?.toLowerCase();
    switch (ext) {
        case 'txt': case 'log': return '📝';
        case 'pdf': return '📕';
        case 'zip': case 'rar': case '7z': return '📦';
        case 'mp3': case 'wav': case 'flac': return '🎵';
        case 'apk': return '📱';
        default: return '📄';
    }
}

function getFileClass(item) {
    if (item.type === 'directory') return 'directory-item';
    if (item.isImage) return 'image-item';
    if (item.isDocument) return 'document-item';
    return '';
}

function selectFileItem(item, element) {
    // Убираем выделение с предыдущего элемента
    document.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
    
    // Выделяем текущий элемент
    element.classList.add('selected');
    selectedFile = item;
}

function navigateToDirectory(path) {
    sendFileSystemCommand({ action: 'list_directory', path: path });
}

function navigateUp() {
    if (currentDirectory) {
        const parentPath = currentDirectory.substring(0, currentDirectory.lastIndexOf('/'));
        navigateToDirectory(parentPath);
    }
}

function refreshDirectory() {
    if (currentDirectory !== undefined) {
        sendFileSystemCommand({ action: 'list_directory', path: currentDirectory });
    }
}

// Предварительный просмотр файлов
function previewFile(file) {
    selectedFile = file;
    
    document.getElementById('previewTitle').textContent = file.name;
    document.getElementById('previewPanel').style.display = 'block';
    
    const previewContent = document.getElementById('previewContent');
    previewContent.innerHTML = '<div style="text-align: center; padding: 20px;"><div class="loading-spinner"></div></div>';
    
    // Определяем тип предварительного просмотра
    let mode = 'info';
    if (file.isImage) {
        mode = 'thumbnail';
    } else if (file.extension && ['txt', 'log', 'json', 'xml', 'html', 'css', 'js'].includes(file.extension.toLowerCase())) {
        mode = 'text';
    }
    
    sendFileSystemCommand({
        action: 'get_file_content',
        file_path: file.path,
        mode: mode
    });
}

function displayFileContent(data) {
    const previewContent = document.getElementById('previewContent');
    
    if (data.error) {
        previewContent.innerHTML = `<div style="color: var(--danger-red); padding: 10px;">Error: ${data.error}</div>`;
        return;
    }
    
    switch (data.mode) {
        case 'thumbnail':
            if (data.thumbnail) {
                previewContent.innerHTML = `
                    <img src="${data.thumbnail}" class="preview-image" alt="Thumbnail">
                    <div style="font-size: 12px; color: var(--text-muted);">
                        Dimensions: ${data.width} x ${data.height}
                    </div>
                `;
            } else {
                previewContent.innerHTML = '<div style="color: #666;">No preview available</div>';
            }
            break;
            
        case 'text':
            if (data.content) {
                previewContent.innerHTML = `
                    <div class="preview-text">${escapeHtml(data.content)}</div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 5px;">
                        Lines: ${data.lineCount || 'N/A'} | Encoding: ${data.encoding || 'Unknown'}
                    </div>
                `;
            }
            break;
            
        case 'info':
        default:
            previewContent.innerHTML = `
                <div style="font-size: 12px; line-height: 1.4;">
                    <div><strong>Size:</strong> ${data.sizeFormatted || 'Unknown'}</div>
                    <div><strong>Type:</strong> ${data.mimeType || 'Unknown'}</div>
                    <div><strong>Modified:</strong> ${data.lastModified || 'Unknown'}</div>
                    <div><strong>Readable:</strong> ${data.canRead ? 'Yes' : 'No'}</div>
                    <div><strong>Writable:</strong> ${data.canWrite ? 'Yes' : 'No'}</div>
                    <div><strong>Path:</strong> <span style="font-family: monospace; font-size: 10px;">${data.path}</span></div>
                </div>
            `;
    }
}

function closePreview() {
    document.getElementById('previewPanel').style.display = 'none';
    selectedFile = null;
}

// Поиск файлов
function showSearchDialog() {
    const searchBar = document.getElementById('searchBar');
    searchBar.style.display = searchBar.style.display === 'none' ? 'block' : 'none';
    
    if (searchBar.style.display === 'block') {
        document.getElementById('searchInput').focus();
    }
}

function performSearch() {
    const query = document.getElementById('searchInput').value.trim();
    if (!query) return;
    
    sendFileSystemCommand({
        action: 'search_files',
        query: query,
        root_path: currentDirectory,
        include_content: true
    });
}

function displaySearchResults(data) {
    if (data.error) {
        showError('Search failed: ' + data.error);
        return;
    }
    
    const fileListElement = document.getElementById('fileList');
    fileListElement.innerHTML = `
        <div style="padding: 10px; border-bottom: 1px solid #333; color: var(--primary-gold);">
            Search Results: "${data.query}" (${data.count} found)
        </div>
    `;
    
    if (data.results && data.results.length > 0) {
        data.results.forEach(item => {
            fileListElement.appendChild(createFileElement(item));
        });
    } else {
        fileListElement.innerHTML += '<div style="text-align: center; color: #666; padding: 20px;">No files found</div>';
    }
}

// Удаление файлов
function deleteCurrentFile() {
    if (!selectedFile) return;
    
    if (!confirm(`Delete "${selectedFile.name}"?`)) return;
    
    sendFileSystemCommand({
        action: 'delete_item',
        path: selectedFile.path
    });
}

function handleDeleteResult(data) {
    if (data.success) {
        closePreview();
        refreshDirectory();
    } else {
        showError('Delete failed: ' + (data.error || 'Unknown error'));
    }
}

// Загрузка файлов (получение содержимого)
function downloadFile() {
    if (!selectedFile) return;
    
    sendFileSystemCommand({
        action: 'get_file_content',
        file_path: selectedFile.path,
        mode: 'base64'
    });
}

// Обновите функцию selectDevice для автоматического подключения к файловой системе
async function selectDevice(deviceId) {
    selectedDeviceId = deviceId;
    renderDevicesList();
    await loadDeviceData(deviceId);
    enableCameraControls();
    
    // Автоматически подключаемся к файловой системе при выборе устройства
    connectToFileSystem();
}

// Вспомогательные функции
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Обновите обработчик WebSocket сообщений для включения файловых команд
// В функции initLiveStreamConnection добавьте:
liveStreamWebSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'image' || data.type === 'audio') {
        // Существующая логика для медиа
        if (data.type === 'image') {
            displayLiveImage(data.data);
        } else if (data.type === 'audio') {
            playAudioData(data.data);
        }
    } else {
        // Новая логика для файловой системы
        handleFileSystemMessage(data);
    }
};
