// Setup IndexedDB
let db = null;
const dbReq = indexedDB.open("LocalAIAssistantDB", 3);
dbReq.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
    }
};
dbReq.onsuccess = (e) => {
    db = e.target.result;
    console.log("Database initialized.");
    loadHistory();
};

let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let finalTranscript = '';
let interimTranscript = '';
let recognition = null;
let wakeLock = null;
let currentSessionId = null;
let currentAudioBlob = null;
let timerInterval = null;
let startTime = null;
let chunkInterval = null;
let lastTranscribedTime = 0;

// Initialize Lucide Icons globally for static HTML
try {
    lucide.createIcons();
} catch (e) {
    console.warn("Lucide auto-init failed, will call manually where needed.", e);
}

// Ensure error display is hidden when starting
function hideError() {
    const errDisp = document.getElementById('sysErrorArea');
    if (errDisp) errDisp.classList.add('hidden');
}

// Request Wake Lock
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.warn(`${err.name}, ${err.message}`);
    }
}
async function releaseWakeLock() {
    if (wakeLock !== null) {
        await wakeLock.release();
        wakeLock = null;
    }
}

// Ensure Web Speech API is maximally optimized
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("お使いのブラウザは音声認識をサポートしていません。Chrome エッジ をご利用ください。");
        return null;
    }
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'ja-JP';
    rec.maxAlternatives = 1;

    rec.onstart = () => {
        const errDisp = document.getElementById('sysErrorArea');
        if (errDisp) errDisp.classList.add('hidden');
        interimTranscript = "(音声認識が起動しました...)";
        updateTranscriptionUI();
    };

    rec.onresult = (event) => {
        let interim = '';
        const currentTimeParts = getFormattedTime(Date.now() - startTime);

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const res = event.results[i];
            if (res.isFinal) {
                const text = res[0].transcript.trim();
                if (text) {
                    finalTranscript += `\n[${currentTimeParts}] ${text}\n`;
                }
            } else {
                interim += res[0].transcript;
            }
        }
        interimTranscript = interim;
        updateTranscriptionUI();
    };

    rec.onerror = (event) => {
        console.warn("Speech recognition error:", event.error);
        const errDisp = document.getElementById('sysErrorArea');
        const errText = document.getElementById('sysErrorText');
        if (errDisp && errText) {
            errDisp.classList.remove('hidden');
            errText.innerText = "音声認識エラー: " + event.error;
        }
        if (event.error === 'not-allowed') {
            alert("マイクへのアクセスが拒否されました。");
            stopRecording();
        }
    };

    rec.onend = () => {
        // Critical for transcription accuracy: keep restarting as long as we are meant to be recording!
        if (isRecording) {
            interimTranscript = "(認識リセット中...)";
            updateTranscriptionUI();
            try {
                rec.start();
            } catch (e) {
                console.error("Failed to restart recognition:", e);
                setTimeout(() => { if (isRecording) rec.start(); }, 500); // Backoff retry
            }
        }
    };

    return rec;
}

function updateTranscriptionUI() {
    const display = document.getElementById('transcriptionDisplay');
    const placeholder = document.getElementById('transcriptionPlaceholder');
    const interimDisp = document.getElementById('interimDisplay');
    
    if (finalTranscript || interimTranscript) {
        placeholder.style.display = 'none';
        
        let escapedText = finalTranscript.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
        const highlighted = escapedText.replace(/\[\d{2}:\d{2}(?::\d{2})?\] 【重要メモ】.*$/gm, (match) => {
            return `<span class="memo-highlight block my-1.5 p-3 rounded-lg border-2 border-amber-500/40 bg-amber-500/10 font-bold shadow-sm shadow-amber-900/20 text-amber-100">${match}</span>`;
        });

        display.innerHTML = highlighted;
        interimDisp.innerText = interimTranscript;
        
        // Auto scroll
        const container = document.getElementById('viewTranscription');
        container.scrollTop = container.scrollHeight;
    } else {
        if (isRecording) {
            placeholder.innerHTML = `
              <i data-lucide="mic" class="w-12 h-12 mb-4 text-blue-500 animate-pulse"></i>
              <p class="text-sm font-bold uppercase tracking-widest mb-1 text-blue-400">録音中...</p>
              <p class="text-[10px] text-slate-400">音声を検出しています。しばらく声を出してみてください。</p>
            `;
            placeholder.style.display = 'flex';
            placeholder.classList.remove('opacity-40');
            lucide.createIcons();
        } else {
            placeholder.innerHTML = `
              <i data-lucide="activity" class="w-12 h-12 mb-4"></i>
              <p class="text-sm font-bold uppercase tracking-widest mb-1">録音準備完了</p>
              <p class="text-[10px]">上のボタンから録音を開始してください</p>
            `;
            placeholder.style.display = 'flex';
            placeholder.classList.add('opacity-40');
            lucide.createIcons();
        }
        display.innerHTML = '';
        interimDisp.innerText = '';
    }
    
    document.getElementById('downloadTransBtn').disabled = !finalTranscript;
}

function getFormattedTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

async function populateMicrophones(requestPermission = false) {
    const micSelect = document.getElementById('micSelect');
    try {
        if (requestPermission) {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop());
        }
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        
        micSelect.innerHTML = '';
        if (audioInputs.length === 0) {
            micSelect.innerHTML = '<option value="">マイクが見つかりません</option>';
            return;
        }

        // Prioritize external/USB mics over default internal devices
        audioInputs.sort((a, b) => {
            const aLabel = a.label.toLowerCase();
            const bLabel = b.label.toLowerCase();
            const isAExternal = aLabel.includes('usb') || aLabel.includes('external') || aLabel.includes('rode') || aLabel.includes('blue');
            const isBExternal = bLabel.includes('usb') || bLabel.includes('external') || bLabel.includes('rode') || bLabel.includes('blue');
            return (isBExternal === isAExternal) ? 0 : isBExternal ? 1 : -1;
        });

        audioInputs.forEach((device) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `マイク ${micSelect.length + 1}`;
            micSelect.appendChild(option);
        });
        
    } catch (e) {
        console.error("Error accessing media devices", e);
        micSelect.innerHTML = '<option value="">権限が必要です (マイクを許可してください)</option>';
        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
            // alert('マイクへのアクセスが拒否されました。設定からマイクの権限を許可し、ページをリロードしてください。');
            console.warn("Permission denied for microphone access. The iframe might need a refresh after permissions are granted in metadata.json");
        }
    }
}

document.getElementById('refreshMicBtn').addEventListener('click', () => populateMicrophones(true));

// Setup recording
async function toggleRecording() {
    const recBtn = document.getElementById('recBtn');
    const recIndicator = document.getElementById('recIndicator');
    const micSelect = document.getElementById('micSelect');
    
    if (isRecording) {
        stopRecording();
    } else {
        const deviceId = micSelect.value;
        const constraints = {
            audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };

        try {
            // Re-init recognition cleanly BEFORE await for Safari compatibility
            recognition = initSpeechRecognition();
            if(!recognition) return;
            recognition.start();
            
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            hideError();
            
            audioChunks = [];
            currentAudioBlob = null;
            finalTranscript = '';
            interimTranscript = '';
            document.getElementById('transcriptionDisplay').innerHTML = '';
            
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };
            
            mediaRecorder.onstop = () => {
                const mimeType = mediaRecorder.mimeType || 'audio/webm';
                currentAudioBlob = new Blob(audioChunks, { type: mimeType });
                document.getElementById('downloadAudioBtn').disabled = false;
                
                promptAndSaveSession(); 
            };
            
            mediaRecorder.start(1000);
            isRecording = true;
            await requestWakeLock();
            
            // UI Updates
            recBtn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
            recBtn.classList.add('bg-red-600', 'hover:bg-red-700');
            recBtn.innerHTML = '<i data-lucide="square" class="w-4 h-4 fill-current"></i> <span>録音停止</span>';
            recIndicator.classList.remove('bg-slate-600');
            recIndicator.classList.add('bg-red-500', 'animate-pulse', 'shadow-[0_0_15px_rgba(239,68,68,0.6)]');
            
            lucide.createIcons();
            micSelect.disabled = true;
            
            startTime = Date.now();
            timerInterval = setInterval(() => {
                document.getElementById('timerDisplay').innerText = getFormattedTime(Date.now() - startTime);
            }, 1000);
            
            updateTranscriptionUI();

        } catch (e) {
            alert("録音の開始に失敗しました。マイクの権限を確認してください。");
            console.error(e);
        }
    }
}

function stopRecording() {
    isRecording = false;
    clearInterval(timerInterval);
    releaseWakeLock();
    
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    
    if (recognition) {
        try { recognition.stop(); } catch(e){}
    }
    
    if (interimTranscript) {
        finalTranscript += `\n[${document.getElementById('timerDisplay').innerText}] ${interimTranscript}\n`;
        interimTranscript = '';
    }
    
    updateTranscriptionUI();
    
    const recBtn = document.getElementById('recBtn');
    const recIndicator = document.getElementById('recIndicator');
    
    recBtn.classList.remove('bg-red-600', 'hover:bg-red-700');
    recBtn.classList.add('bg-blue-600', 'hover:bg-blue-700');
    recBtn.innerHTML = '<i data-lucide="mic" class="w-4 h-4"></i> <span>録音開始</span>';
    recIndicator.classList.remove('bg-red-500', 'animate-pulse', 'shadow-[0_0_15px_rgba(239,68,68,0.6)]');
    recIndicator.classList.add('bg-slate-600');
    
    lucide.createIcons();
    document.getElementById('micSelect').disabled = false;
}

// Data flow
function promptAndSaveSession() {
    if (!finalTranscript.trim() && !currentAudioBlob) return;
    
    const defaultTitle = new Date().toLocaleString() + " の会議";
    const userTitle = prompt("録音を終了しました。\nセッションのタイトルを入力して保存しますか？", defaultTitle);
    
    if (userTitle !== null) {
        saveSessionToDB(userTitle.trim() || defaultTitle);
    } else {
        // Just save with default if cancelled to prevent loss, actually let's save as "未設定"
        saveSessionToDB(defaultTitle + " (自動保存)");
    }
}

function saveSessionToDB(title) {
    if (!db) return;
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    
    const sessionText = finalTranscript.trim() || "(空のトランスクリプト)";
    
    // Build Session Object
    const sessionObj = {
        title: title,
        text: sessionText,
        audioBlob: currentAudioBlob,
        timestamp: Date.now()
    };
    
    const req = store.add(sessionObj);
    req.onsuccess = (e) => {
        currentSessionId = e.target.result; // Update Current Session Tracking
        loadHistory();
    };
    req.onerror = (e) => {
        console.error("Save failed", e);
        alert("セッションの保存に失敗しました。ストレージ容量を確認してください。");
    };
}

function loadHistory() {
    if (!db) return;
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const req = store.getAll();
    
    req.onsuccess = (e) => {
        const sessions = e.target.result;
        sessions.sort((a, b) => b.timestamp - a.timestamp); // Newest first
        
        const list = document.getElementById('historyList');
        list.innerHTML = '';
        
        let totalBytes = 0;
        
        if (sessions.length === 0) {
            list.innerHTML = '<div class="text-center py-10 text-slate-600 text-xs italic">保存されたデータはありません</div>';
            document.getElementById('storageUsageText').innerText = "0 MB";
            document.getElementById('storageUsageBar').style.width = "0%";
            return;
        }

        sessions.forEach(session => {
            if (session.audioBlob) totalBytes += session.audioBlob.size;
            
            const dateStr = new Date(session.timestamp).toLocaleDateString();
            const timeStr = new Date(session.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            const item = document.createElement('div');
            item.className = `p-3 rounded-lg border cursor-pointer hover:bg-slate-800 transition group mb-2 ${currentSessionId === session.id ? 'border-blue-500 bg-blue-900/20' : 'border-slate-800 bg-slate-900/40'}`;
            
            item.innerHTML = `
                <div class="flex justify-between items-start mb-1">
                    <h4 class="font-bold text-slate-200 text-sm truncate pr-2 group-hover:text-blue-400 transition" 
                        onclick="loadSpecificSession(${session.id})" title="${session.title}">${session.title}</h4>
                </div>
                <div class="flex justify-between items-center text-[10px] text-slate-500">
                    <span>${dateStr} ${timeStr}</span>
                    <div class="flex gap-2">
                        <button class="edit-session-btn p-1.5 text-slate-300 hover:text-emerald-400 bg-slate-800 hover:bg-slate-700 rounded transition border border-slate-700" data-id="${session.id}" title="タイトル編集">
                            <i data-lucide="edit-2" class="w-4 h-4"></i>
                        </button>
                        <button class="delete-session-btn p-1.5 text-slate-300 hover:text-red-400 bg-slate-800 hover:bg-slate-700 rounded transition border border-slate-700" data-id="${session.id}" title="このセッションを削除">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </div>
            `;
            list.appendChild(item);
        });
        
        // Setup listeners for edit/delete
        document.querySelectorAll('.edit-session-btn').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                editSessionTitle(parseInt(btn.getAttribute('data-id')));
            });
        });
        
        document.querySelectorAll('.delete-session-btn').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                deleteSession(parseInt(btn.getAttribute('data-id')));
            });
        });
        
        // Update Storage visually
        const mb = (totalBytes / (1024 * 1024)).toFixed(1);
        document.getElementById('storageUsageText').innerText = `${mb} MB`;
        const percentage = Math.min((totalBytes / (500 * 1024 * 1024)) * 100, 100); 
        document.getElementById('storageUsageBar').style.width = `${percentage}%`;
        
        lucide.createIcons();
    };
}

window.loadSpecificSession = function(id) {
    if (!db) return;
    
    // Prevent accidental load while recording
    if (isRecording) {
        alert("録音中はセッションの切り替えができません。");
        return;
    }
    
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const req = store.get(id);
    
    req.onsuccess = (e) => {
        const session = e.target.result;
        if (session) {
            currentSessionId = session.id;
            finalTranscript = session.text || '';
            interimTranscript = '';
            currentAudioBlob = session.audioBlob;
            
            updateTranscriptionUI();
            document.getElementById('downloadAudioBtn').disabled = !currentAudioBlob;
            loadHistory(); // To update the blue border styling
        }
    };
};

function editSessionTitle(id) {
    if (!db) return;
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    store.get(id).onsuccess = (e) => {
        const session = e.target.result;
        if (!session) return;
        
        const newTitle = prompt("新しいタイトルを入力してください:", session.title);
        if (newTitle && newTitle.trim() !== "") {
            session.title = newTitle.trim();
            const wTx = db.transaction('sessions', 'readwrite');
            wTx.objectStore('sessions').put(session).onsuccess = () => {
                loadHistory(); 
            };
        }
    };
}

function deleteSession(id) {
    if(confirm("この保存済みセッションを削除しますか？\n(元に戻すことはできません)")) {
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').delete(id).onsuccess = () => {
            if (currentSessionId === id) {
                // We deleted the currently viewing session, clear screen!
                finalTranscript = '';
                interimTranscript = '';
                currentAudioBlob = null;
                currentSessionId = null;
                updateTranscriptionUI();
                document.getElementById('downloadAudioBtn').disabled = true;
                document.getElementById('downloadTransBtn').disabled = true;
            }
            loadHistory();
        };
    }
}

// Global UI Handlers
document.addEventListener('DOMContentLoaded', () => {
    populateMicrophones(false);

    document.getElementById('recBtn').addEventListener('click', toggleRecording);
    
    // Buttons
    document.getElementById('clearDataBtn').addEventListener('click', () => {
        if(confirm("画面上のテキストと直近の音声を消去しますか？\n※履歴に保存済みのデータは削除されません。")) {
            finalTranscript = '';
            interimTranscript = '';
            currentAudioBlob = null;
            currentSessionId = null;
            updateTranscriptionUI();
            loadHistory();
        }
    });

    document.getElementById('downloadTransBtn').addEventListener('click', () => {
        if(!finalTranscript) return;
        const defaultName = new Date().toLocaleString() + "_文字起こし.txt";
        const titleMatch = finalTranscript.match(/^\[(.*?)\] (.*)$/m);
        let name = "文字起こし.txt";
        
        // Find if current session has a title in DB
        if (currentSessionId && db) {
            const tx = db.transaction('sessions','readonly');
            tx.objectStore('sessions').get(currentSessionId).onsuccess = (e) => {
                if(e.target.result) {
                    executeDownload(finalTranscript, e.target.result.title + ".txt", "text/plain");
                }
            };
        } else {
             executeDownload(finalTranscript, defaultName, "text/plain");
        }
    });

    document.getElementById('downloadAudioBtn').addEventListener('click', () => {
        if(!currentAudioBlob) return;
         if (currentSessionId && db) {
            const tx = db.transaction('sessions','readonly');
            tx.objectStore('sessions').get(currentSessionId).onsuccess = (e) => {
                if(e.target.result) {
                    executeBlobDownload(currentAudioBlob, e.target.result.title + ".webm");
                }
            };
        } else {
            executeBlobDownload(currentAudioBlob, "録音音声.webm");
        }
    });

    // Memos
    document.getElementById('addMemoBtn').addEventListener('click', addMemo);
    document.getElementById('manualMemoInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            addMemo();
        }
    });
    
    function addMemo() {
        const input = document.getElementById('manualMemoInput');
        const text = input.value.trim();
        if (!text) return;
        
        const timeStr = document.getElementById('timerDisplay').innerText;
        const memoEntry = `\n[${timeStr}] 【重要メモ】 ${text}\n`;
        
        finalTranscript += memoEntry;
        input.value = '';
        updateTranscriptionUI();
    }
    
    // Sidebar toggle for mobile
    const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');
    const sidebar = document.getElementById('sidebar');

    toggleSidebarBtn?.addEventListener('click', () => {
        sidebar.classList.remove('-translate-x-full');
    });

    closeSidebarBtn?.addEventListener('click', () => {
        sidebar.classList.add('-translate-x-full');
    });
});

function executeDownload(content, filename, type) {
    const blob = new Blob([content], { type });
    executeBlobDownload(blob, filename);
}

function executeBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, 0);
}

// PWA Warning
window.addEventListener('beforeunload', (e) => {
    if (isRecording) {
        e.preventDefault();
        const msg = '録音中です。ページを離れると録音が停止します。離れますか？';
        e.returnValue = msg;
        return msg;
    }
});
