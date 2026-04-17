let engine = null;
let CreateMLCEngine = null;
let prebuiltAppConfig = null;
let mermaidLoaded = false;
let markedInstance = null;

// Lazy loader for AI libraries
async function loadAiLibraries() {
    if (CreateMLCEngine) return;
    try {
        const mlc = await import("@mlc-ai/web-llm");
        CreateMLCEngine = mlc.CreateMLCEngine;
        prebuiltAppConfig = mlc.prebuiltAppConfig;
        
        const markedMod = await import("marked");
        markedInstance = markedMod.marked;
    } catch (e) {
        console.error("Failed to load AI libraries:", e);
        throw e;
    }
}

// Lazy loader for Mermaid
async function loadMermaid() {
    if (mermaidLoaded) return;
    try {
        const m = await (await import("mermaid")).default;
        m.initialize({ startOnLoad: false, theme: 'dark' });
        mermaidLoaded = true;
        return m;
    } catch (e) {
        console.error("Failed to load Mermaid:", e);
    }
}

const APP_VERSION = "2.0.3";

// Define custom models (Gemma 4 E4B/E2B) by mapping them to Gemma 2 2B weights for now
const customModelList = [
    {
        model_id: "gemma-4-e4b-it-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_80/gemma-2-2b-it-q4f16_1-ctx4k_cs1k-webgpu.wasm",
        vram_required_MB: 1895.3,
        low_resource_required: false,
        required_features: ["shader-f16"],
        model: "https://huggingface.co/mlc-ai/gemma-2-2b-it-q4f16_1-MLC"
    },
    {
        model_id: "gemma-4-E2B-it-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_80/gemma-2-2b-it-q4f16_1-ctx4k_cs1k-webgpu.wasm",
        vram_required_MB: 1583.3,
        low_resource_required: true,
        required_features: ["shader-f16"],
        model: "https://huggingface.co/welcoma/gemma-4-E2B-it-q4f16_1-MLC"
    },
    {
        model_id: "gemma-3-9b-it-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_80/gemma-2-9b-it-q4f16_1-ctx4k_cs1k-webgpu.wasm",
        vram_required_MB: 5000,
        low_resource_required: false,
        required_features: ["shader-f16"],
        model: "https://huggingface.co/mlc-ai/gemma-2-9b-it-q4f16_1-MLC"
    }
];

// Config getter
async function getAppConfig() {
    await loadAiLibraries();
    return {
        model_list: [...prebuiltAppConfig.model_list, ...customModelList]
    };
}

// Lucide Icons Initialization
lucide.createIcons();

// --- State Variables ---
let isRecording = false;
let isProcessingAI = false;
let timerInterval, startTime;
let mediaRecorder = null, audioChunks = [], currentAudioBlob = null;
let finalTranscript = '', interimTranscript = '', recognition = null, wakeLock = null;
let currentSessionMap = new Map(); 
let db = null; 
let currentSessionId = localStorage.getItem('local_ai_current_session_id') ? parseInt(localStorage.getItem('local_ai_current_session_id')) : null;
let lastSavedText = '';
let lastSavedAi = '';
let lastSavedAudioSize = 0;

// WebLLM Engine
let realtimeAiBuffer = '';
let isRealtimeProcessing = false;

// --- IndexedDB Initialization (Audio & Session Backup) ---
const dbReq = indexedDB.open("LocalAIAssistantDB", 2);
dbReq.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('backups')) {
        db.createObjectStore('backups', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
    }
};
dbReq.onsuccess = (e) => {
    db = e.target.result;
    checkRecovery();
    loadHistory();
};

function checkRecovery() {
    const savedText = localStorage.getItem('local_ai_assistant_text');
    if (savedText) {
        finalTranscript = savedText;
        updateTranscriptionUI();
    }
    if (db) {
        const tx = db.transaction('backups', 'readonly');
        const getReq = tx.objectStore('backups').get('latest_audio');
        getReq.onsuccess = (e) => {
            if (e.target.result && e.target.result.blob) {
                currentAudioBlob = e.target.result.blob;
                document.getElementById('downloadAudioBtn').disabled = false;
            }
        };
    }
    
    // Set lastSavedText to initial text to prevent immediate redundant save
    lastSavedText = finalTranscript;
}

// --- PWA & Browser Checks ---
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (!isMobile && !window.matchMedia('(display-mode: standalone)').matches) {
        document.getElementById('pwaInstallModal').classList.remove('hidden');
        lucide.createIcons();
    }
});

// --- Utility Functions ---
async function fetchRemoteVersion() {
    try {
        // Cache busting with timestamp
        const res = await fetch(`/version.json?t=${Date.now()}`);
        if (res.ok) {
            const data = await res.json();
            return data.version;
        }
    } catch (e) {
        console.warn("Failed to fetch remote version:", e);
    }
    return null;
}

function showSetupModal(oldVer, newVer) {
    const setupModal = document.getElementById('setupModal');
    const setupModalMessage = document.getElementById('setupModalMessage');
    const finishSetupBtn = document.getElementById('finishSetupBtn');
    const modelSelect = document.getElementById('modelNameInput');

    if (!oldVer) {
        setupModalMessage.innerText = "ご利用ありがとうございます。最高のAI体験を提供するため、初期セットアップを行います。推奨モデル（GEMMA 4）を選択してください。";
    } else {
        setupModalMessage.innerHTML = `バージョンが <strong>${oldVer}</strong> から <strong>${newVer}</strong> へアップデートされました。<br>最新のAIエンジンに合わせて、使用するモデルを再選択してください。`;
    }

    setupModal.classList.remove('hidden');
    lucide.createIcons();

    // Use a fresh cloned button to clear previous listeners
    const newBtn = finishSetupBtn.cloneNode(true);
    finishSetupBtn.parentNode.replaceChild(newBtn, finishSetupBtn);

    newBtn.addEventListener('click', () => {
        const selectedModel = document.querySelector('input[name="setupModel"]:checked').value;
        localStorage.setItem('webllm_model', selectedModel);
        localStorage.setItem('app_version', newVer);
        setupModal.classList.add('hidden');
        
        // Re-sync UI
        if (modelSelect) modelSelect.value = selectedModel;
        
        // Force reload to apply new engine if splash is gone, otherwise just load splash
        if (!document.getElementById('splashScreen')) {
            location.reload();
        } else {
            startSplashAndInit();
        }
    }, { once: true });
}

// --- DOM Elements & Event Listeners ---
window.addEventListener('DOMContentLoaded', async () => {
    // 1. LINE Browser Check
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    if (ua.indexOf("Line") > -1) {
        document.getElementById('lineWarningModal').classList.remove('hidden');
        lucide.createIcons();
    }

    // 2. Register Service Worker for PWA & Handle Updates
    let newWorker;
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then(reg => {
            reg.addEventListener('updatefound', () => {
                newWorker = reg.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        document.getElementById('pwaUpdateModal').classList.remove('hidden');
                        lucide.createIcons();
                    }
                });
            });
        }).catch(err => console.warn('SW registration failed:', err));

        let refreshing;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            window.location.reload();
            refreshing = true;
        });
    }

    document.getElementById('pwaUpdateBtn')?.addEventListener('click', () => {
        if (newWorker) {
            newWorker.postMessage({ type: 'SKIP_WAITING' });
        }
    });

    document.getElementById('pwaInstallBtn')?.addEventListener('click', async () => {
        document.getElementById('pwaInstallModal').classList.add('hidden');
        if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt = null;
        }
    });
    document.getElementById('pwaInstallCancelBtn')?.addEventListener('click', () => {
        document.getElementById('pwaInstallModal').classList.add('hidden');
    });

    initApp();
    const modelSelect = document.getElementById('modelNameInput');
    
    // Version check for mandatory setup/update (Remote & Local)
    const savedVersion = localStorage.getItem('app_version');
    const remoteVersion = await fetchRemoteVersion();
    const effectiveVersion = remoteVersion || APP_VERSION;
    const isNewVersion = savedVersion !== effectiveVersion;
    
    if (isNewVersion) {
        showSetupModal(savedVersion, effectiveVersion);
    } else {
        // Normal Startup
        let savedModel = localStorage.getItem('webllm_model');
        
        if (savedModel && Array.from(modelSelect.options).some(opt => opt.value === savedModel)) {
            modelSelect.value = savedModel;
        } else {
            // Default to Gemma 4 4B for v2.0+
            modelSelect.value = 'gemma-4-e4b-it-q4f16_1-MLC';
            localStorage.setItem('webllm_model', modelSelect.value);
        }
        
        startSplashAndInit();
    }

    // Periodic Background Version Check (every 5 minutes)
    setInterval(async () => {
        const latestVer = await fetchRemoteVersion();
        const currentVer = localStorage.getItem('app_version');
        if (latestVer && latestVer !== currentVer) {
            // Check if modal is already open
            if (document.getElementById('setupModal').classList.contains('hidden')) {
                showSetupModal(currentVer, latestVer);
            }
        }
    }, 5 * 60 * 1000);

    // Start Splash Model Change button
    document.getElementById('splashChangeModelBtn').addEventListener('click', () => {
        document.getElementById('settingsModal').classList.remove('hidden');
        document.getElementById('settingsModal').style.zIndex = "200"; // Ensure it's above splash
    });

    // Buttons
    document.getElementById('recBtn').addEventListener('click', toggleRecording);
    document.getElementById('refreshMicBtn').addEventListener('click', updateMicList);
    document.getElementById('downloadAudioBtn').addEventListener('click', () => {
        let ext = '.webm';
        if (currentAudioBlob) {
            if (currentAudioBlob.type.includes('mp4')) ext = '.mp4';
            else if (currentAudioBlob.type.includes('ogg')) ext = '.ogg';
            else if (currentAudioBlob.type.includes('mp3')) ext = '.mp3';
        }
        handleSave(currentAudioBlob, ext, '音声データ');
    });
    document.getElementById('downloadTransBtn').addEventListener('click', () => {
        const blob = new Blob([finalTranscript], { type: 'text/plain' });
        handleSave(blob, '.txt', '文字起こしデータ');
    });
    document.getElementById('generateBtn').addEventListener('click', generateSummary);
    
    // Copy AI Result
    document.getElementById('copyAiBtn').addEventListener('click', () => {
        const text = document.getElementById('summaryDisplay').innerText;
        if(text) {
            navigator.clipboard.writeText(text).then(() => {
                const btn = document.getElementById('copyAiBtn');
                const originalHtml = btn.innerHTML;
                btn.innerHTML = '<i data-lucide="check" class="w-4 h-4 text-green-400"></i>';
                lucide.createIcons();
                setTimeout(() => { btn.innerHTML = originalHtml; lucide.createIcons(); }, 2000);
            });
        }
    });

    // Settings
    const modelWarning = document.getElementById('modelChangeWarning');
    const initialModel = localStorage.getItem('webllm_model') || 'gemma-4-e4b-it-q4f16_1-MLC';

    modelSelect.addEventListener('change', () => {
        if (modelSelect.value !== initialModel) {
            modelWarning.classList.remove('hidden');
        } else {
            modelWarning.classList.add('hidden');
        }
    });

    document.getElementById('settingsBtn').addEventListener('click', () => {
        modelSelect.value = localStorage.getItem('webllm_model') || initialModel;
        modelWarning.classList.add('hidden');
        document.getElementById('settingsModal').classList.remove('hidden');
    });
    document.getElementById('closeSettingsBtn').addEventListener('click', () => document.getElementById('settingsModal').classList.add('hidden'));
    document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);

    // AI Modal Logic
    const aiModal = document.getElementById('aiAnalysisModal');
    document.getElementById('openAiPanelBtn').addEventListener('click', () => {
        aiModal.classList.remove('hidden');
    });
    document.getElementById('closeAiModalBtn').addEventListener('click', () => {
        aiModal.classList.add('hidden');
    });

    // Sidebar & Tasks
    document.getElementById('toggleSidebarBtn').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('-translate-x-full');
    });
    document.getElementById('closeSidebarBtn').addEventListener('click', () => {
        document.getElementById('sidebar').classList.add('-translate-x-full');
    });
    
    document.getElementById('newSessionBtn').addEventListener('click', startNewSession);
    document.getElementById('downloadTextBtnModal').addEventListener('click', downloadAiOutput);

    // AI Task Checkbox UI Enhancement (Manual toggle since they are hidden)
    document.querySelectorAll('#aiTasksList label').forEach(label => {
        const input = label.querySelector('input');
        const iconContainer = label.querySelector('.w-4.h-4.rounded');
        const checkIcon = iconContainer.querySelector('[data-lucide="check"]');

        const updateUI = () => {
            if (input.checked) {
                iconContainer.classList.add('border-emerald-500', 'bg-emerald-500');
                iconContainer.classList.remove('border-slate-600');
                if (checkIcon) checkIcon.classList.remove('hidden');
            } else {
                iconContainer.classList.remove('border-emerald-500', 'bg-emerald-500');
                iconContainer.classList.add('border-slate-600');
                if (checkIcon) checkIcon.classList.add('hidden');
            }
        };

        input.addEventListener('change', updateUI);
        updateUI(); // Initial
    });

    // Manual Memo
    const addManualMemo = () => {
        const input = document.getElementById('manualMemoInput');
        const text = input.value.trim();
        if (!text) return;
        
        const timestamp = isRecording ? document.getElementById('timerDisplay').innerText : new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const memoEntry = `\n[${timestamp}] 【重要メモ】 ${text}\n`;
        
        finalTranscript += memoEntry;
        realtimeAiBuffer += `【重要メモ】 ${text} `; // Append to realtime buffer
        
        input.value = '';
        updateTranscriptionUI();
        saveSession();
        
        // Trigger realtime AI immediately if recording
        if (isRecording) {
            processRealtimeAI();
        }
    };

    document.getElementById('addMemoBtn').addEventListener('click', addManualMemo);
    document.getElementById('manualMemoInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            addManualMemo();
        }
    });

    // Load Settings
    // (Already handled in DOMContentLoaded for splash)

    // Clear Data
    document.getElementById('clearDataBtn').addEventListener('click', () => {
        if(confirm("⚠️ 記録された音声とテキストデータをすべて消去しますか？\n（復元できなくなります）")) {
            finalTranscript = ''; interimTranscript = ''; currentSessionMap.clear();
            currentAudioBlob = null;
            localStorage.removeItem('local_ai_assistant_text');
            if (db) {
                const tx = db.transaction('backups', 'readwrite');
                tx.objectStore('backups').delete('latest_audio');
            }
            updateTranscriptionUI();
            document.getElementById('transcriptionDisplay').innerText = '';
            document.getElementById('transcriptionPlaceholder').style.display = 'flex';
            document.getElementById('downloadAudioBtn').disabled = true;
            document.getElementById('downloadTransBtn').disabled = true;
            
            document.getElementById('summaryDisplay').style.display = 'none';
            document.getElementById('summaryPlaceholder').style.display = 'flex';
            document.getElementById('copyAiBtn').classList.add('hidden');
            document.getElementById('timerDisplay').innerText = '00:00:00';
        }
    });

    // Prevent accidental close
    window.addEventListener('beforeunload', (e) => {
        if (isRecording || isProcessingAI) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    document.addEventListener('visibilitychange', async () => {
        if (wakeLock !== null && document.visibilityState === 'visible' && isRecording) await requestWakeLock();
    });
});

function saveSettings() {
    const newModel = document.getElementById('modelNameInput').value;
    const oldModel = localStorage.getItem('webllm_model');
    
    localStorage.setItem('webllm_model', newModel);
    document.getElementById('settingsModal').classList.add('hidden');
    
    // Reload if model changed OR if splash is visible
    if (newModel !== oldModel || document.getElementById('splashScreen')) {
        location.reload();
    }
}

// --- History & Session Management ---
async function loadHistory() {
    if (!db) return;
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    
    const list = document.getElementById('historyList');
    list.innerHTML = '';
    let totalSize = 0;
    let count = 0;
    const maxItems = 50; // Limit display items for performance

    const cursorRequest = store.openCursor(null, 'prev');
    
    cursorRequest.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && count < maxItems) {
            const session = cursor.value;
            count++;
            
            const item = document.createElement('button');
            item.className = `w-full text-left p-3 rounded-md transition flex flex-col gap-1 group ${currentSessionId === session.id ? 'bg-blue-900/40 border border-blue-800/50' : 'hover:bg-slate-900 border border-transparent'}`;
            
            const date = new Date(session.timestamp).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const title = session.title || '無題のセッション';
            const snippet = session.text ? session.text.substring(0, 30) : '';
            
            item.innerHTML = `
                <div class="flex justify-between items-start">
                    <span class="text-xs font-bold text-slate-200 truncate pr-2 w-full">${title}</span>
                    <span class="text-[10px] text-slate-500 shrink-0">${date}</span>
                </div>
                <div class="flex justify-between items-center mt-1">
                    <span class="text-[10px] text-slate-500 truncate">${snippet}...</span>
                    <div class="flex opacity-0 group-hover:opacity-100 transition">
                        <button class="edit-session-btn p-1 text-slate-600 hover:text-blue-400" data-id="${session.id}" title="タイトル編集">
                            <i data-lucide="edit-2" class="w-3 h-3"></i>
                        </button>
                        <button class="delete-session-btn p-1 text-slate-600 hover:text-red-400" data-id="${session.id}" title="削除">
                            <i data-lucide="trash-2" class="w-3 h-3"></i>
                        </button>
                    </div>
                </div>
            `;
            
            item.addEventListener('click', (ev) => {
                if (ev.target.closest('.delete-session-btn')) {
                    deleteSession(session.id);
                } else if (ev.target.closest('.edit-session-btn')) {
                    editSessionTitle(session.id, title);
                } else {
                    loadSession(session.id);
                }
            });
            list.appendChild(item);
            
            if (session.audioBlob) totalSize += session.audioBlob.size;
            if (session.text) totalSize += session.text.length * 2;
            if (session.aiResults) totalSize += session.aiResults.length * 2;
            
            cursor.continue();
        } else {
            if (count === 0) {
                list.innerHTML = '<div class="text-center py-10 text-slate-600 text-xs italic">保存されたデータはありません</div>';
            }
            updateStorageUsage(totalSize);
            lucide.createIcons();
        }
    };
}

async function saveSession() {
    if (!db || (!finalTranscript && currentSessionMap.size === 0)) return;
    
    // Commit any pending results before saving
    let sessionText = '';
    for (let [index, item] of currentSessionMap.entries()) {
        sessionText += `[${item.time}] ${item.text}\n`;
    }
    const fullTextToSave = finalTranscript + sessionText;
    const currentAiResults = document.getElementById('summaryDisplay').innerHTML;
    const currentAudioSize = currentAudioBlob ? currentAudioBlob.size : 0;

    // Prevent saving if content is identical to last saved state
    if (fullTextToSave === lastSavedText && 
        currentAiResults === lastSavedAi && 
        currentAudioSize === lastSavedAudioSize && 
        currentSessionId) return;
        
    lastSavedText = fullTextToSave;
    lastSavedAi = currentAiResults;
    lastSavedAudioSize = currentAudioSize;

    // Generate a cleaner title by stripping timestamps
    let cleanTitle = fullTextToSave.replace(/\[\d{2}:\d{2}:\d{2}\]\s*/g, '').substring(0, 30).trim() || '新規セッション';
    if (cleanTitle.length >= 30) cleanTitle += '...';

    const sessionData = {
        timestamp: Date.now(),
        title: cleanTitle,
        text: fullTextToSave,
        realtimeText: document.getElementById('realtimeAiDisplay').innerText,
        audioBlob: currentAudioBlob,
        aiResults: document.getElementById('summaryDisplay').innerHTML,
        hasAi: !document.getElementById('summaryDisplay').classList.contains('hidden')
    };

    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    
    if (currentSessionId) {
        sessionData.id = currentSessionId;
        store.put(sessionData);
    } else {
        const addReq = store.add(sessionData);
        addReq.onsuccess = (e) => {
            currentSessionId = e.target.result;
            localStorage.setItem('local_ai_current_session_id', currentSessionId);
            loadHistory();
        };
    }
    
    tx.oncomplete = () => loadHistory();
}

async function loadSession(id) {
    if (!db) return;
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const request = store.get(id);

    request.onsuccess = async () => {
        const session = request.result;
        if (!session) return;

        currentSessionId = session.id;
        localStorage.setItem('local_ai_current_session_id', currentSessionId);
        finalTranscript = session.text;
        lastSavedText = session.text;
        lastSavedAi = session.aiResults || '';
        lastSavedAudioSize = session.audioBlob ? session.audioBlob.size : 0;
        currentAudioBlob = session.audioBlob;
        
        updateTranscriptionUI();
        
        const realtimeDisplay = document.getElementById('realtimeAiDisplay');
        const realtimePlaceholder = document.getElementById('realtimePlaceholder');
        if (session.realtimeText) {
            realtimeDisplay.innerText = session.realtimeText;
            realtimeDisplay.classList.remove('hidden');
            realtimePlaceholder.classList.add('hidden');
        } else {
            realtimeDisplay.innerText = '';
            realtimeDisplay.classList.add('hidden');
            realtimePlaceholder.classList.remove('hidden');
        }
        
        const summaryDisplay = document.getElementById('summaryDisplay');
        const summaryPlaceholder = document.getElementById('summaryPlaceholder');
        
        if (session.hasAi) {
            summaryDisplay.innerHTML = session.aiResults;
            summaryDisplay.classList.remove('hidden');
            summaryPlaceholder.classList.add('hidden');
            document.getElementById('copyAiBtn').classList.remove('hidden');
            document.getElementById('downloadTextBtn').classList.remove('hidden');
            
            // Re-render Mermaid if present
            const mermaidDivs = summaryDisplay.querySelectorAll('.mermaid');
            if (mermaidDivs.length > 0) {
                const m = await loadMermaid();
                mermaidDivs.forEach(div => {
                    const code = div.getAttribute('data-code');
                    if (code) {
                        div.removeAttribute('data-processed');
                        div.innerHTML = code;
                    }
                });
                if (m && m.run) {
                    try { await m.run(); } catch(e) { console.error("Mermaid run error:", e); }
                }
            }
        } else {
            summaryDisplay.classList.add('hidden');
            summaryPlaceholder.classList.remove('hidden');
            document.getElementById('copyAiBtn').classList.add('hidden');
            document.getElementById('downloadTextBtn').classList.add('hidden');
        }
        
        document.getElementById('downloadAudioBtn').disabled = !currentAudioBlob;
        document.getElementById('downloadTransBtn').disabled = !finalTranscript;
        loadHistory();
        
        // Close sidebar on mobile
        if (window.innerWidth < 1024) {
            document.getElementById('sidebar').classList.add('-translate-x-full');
        }
    };
}

async function deleteSession(id) {
    if (!confirm("このセッションを削除しますか？")) return;
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').delete(id);
    tx.oncomplete = () => {
        if (currentSessionId === id) startNewSession();
        loadHistory();
    };
}

async function editSessionTitle(id, currentTitle) {
    const newTitle = prompt('新しいタイトルを入力してください', currentTitle);
    if (newTitle !== null && newTitle.trim() !== '') {
        const tx = db.transaction('sessions', 'readwrite');
        const store = tx.objectStore('sessions');
        const getReq = store.get(id);
        getReq.onsuccess = (e) => {
            const session = e.target.result;
            if (session) {
                session.title = newTitle.trim();
                store.put(session);
            }
        };
        tx.oncomplete = () => {
            loadHistory();
        };
    }
}

function startNewSession() {
    currentSessionId = null;
    localStorage.removeItem('local_ai_current_session_id');
    finalTranscript = '';
    lastSavedText = '';
    lastSavedAi = '';
    lastSavedAudioSize = 0;
    interimTranscript = '';
    currentAudioBlob = null;
    currentSessionMap.clear();
    realtimeAiBuffer = '';
    
    updateTranscriptionUI();
    document.getElementById('transcriptionPlaceholder').style.display = 'flex';
    document.getElementById('realtimeAiDisplay').innerText = '';
    document.getElementById('realtimeAiDisplay').classList.add('hidden');
    document.getElementById('realtimePlaceholder').classList.remove('hidden');
    
    document.getElementById('summaryDisplay').classList.add('hidden');
    document.getElementById('summaryPlaceholder').classList.remove('hidden');
    document.getElementById('copyAiBtn').classList.add('hidden');
    document.getElementById('downloadTextBtn').classList.add('hidden');
    document.getElementById('downloadAudioBtn').disabled = true;
    document.getElementById('downloadTransBtn').disabled = true;
    document.getElementById('timerDisplay').innerText = '00:00:00';
    
    loadHistory();
}

function updateStorageUsage(bytes) {
    const mb = (bytes / (1024 * 1024)).toFixed(2);
    document.getElementById('storageUsageText').innerText = `${mb} MB`;
    const percent = Math.min(100, (bytes / (50 * 1024 * 1024)) * 100); // 50MB limit for bar
    document.getElementById('storageUsageBar').style.width = `${percent}%`;
}

// --- Splash & Pre-init Logic ---
async function startSplashAndInit() {
    const splashScreen = document.getElementById('splashScreen');
    const splashStatusText = document.getElementById('splashStatusText');
    const splashSubtext = document.getElementById('splashSubtext');
    const splashLoadingArea = document.getElementById('splashLoadingArea');
    const splashProgressBar = document.getElementById('splashProgressBar');
    const splashPercentText = document.getElementById('splashPercentText');
    const splashTimeRemaining = document.getElementById('splashTimeRemaining');
    const splashChangeModelBtn = document.getElementById('splashChangeModelBtn');
    
    // --- Mobile Checking ---
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
        document.body.classList.add('is-mobile');
    }

    const isLowMemory = navigator.deviceMemory && navigator.deviceMemory < 8; // Less than 8GB RAM

    if (!navigator.gpu || isMobile || isLowMemory) {
        console.warn("Skipping AI preload to prevent memory crashes on mobile/low-memory devices.");
        if (splashStatusText) splashStatusText.innerText = "軽量モードで起動します";
        if (splashSubtext) splashSubtext.innerText = "モバイル端末またはメモリ節約のため、AIの自動読み込みをスキップしました。録音と文字起こしはすぐにご利用いただけます。";
        const pb = document.getElementById('splashProgressBar');
        if (pb) pb.classList.add('bg-blue-500');

        setTimeout(() => {
            if (splashScreen) {
                splashScreen.classList.add('opacity-0');
                setTimeout(() => splashScreen.remove(), 700);
            }
        }, 2000);
        return; 
    }

    // 3 second minimum timer
    const minTimer = new Promise(resolve => setTimeout(resolve, 3000));

    const modelName = document.getElementById('modelNameInput').value;
    
    let downloadStartTime = null;
    let lastProgress = 0;

    const initProgressCallback = (initProgress) => {
        // If progress is less than 1, it's likely downloading or doing heavy work
        if (initProgress.progress < 1) {
            splashLoadingArea.classList.remove('opacity-0');
            splashSubtext.innerText = "AIモデルをダウンロード中（初回やモデル変更時は大容量の通信が発生します）...";
            
            if (downloadStartTime === null) {
                downloadStartTime = Date.now();
            }

            // Estimate time remaining
            const currentTime = Date.now();
            const elapsedSeconds = (currentTime - downloadStartTime) / 1000;
            
            if (initProgress.progress > 0 && elapsedSeconds > 1) {
                const totalEstimatedSeconds = elapsedSeconds / initProgress.progress;
                const remainingSeconds = Math.max(0, totalEstimatedSeconds - elapsedSeconds);
                
                if (remainingSeconds > 60) {
                    const mins = Math.floor(remainingSeconds / 60);
                    const secs = Math.floor(remainingSeconds % 60);
                    splashTimeRemaining.innerText = `残り約 ${mins}分 ${secs}秒`;
                } else {
                    splashTimeRemaining.innerText = `残り約 ${Math.floor(remainingSeconds)}秒`;
                }
            }
        } else {
            splashTimeRemaining.innerText = "";
        }
        
        const percent = Math.round(initProgress.progress * 100);
        splashProgressBar.style.width = `${percent}%`;
        splashPercentText.innerText = `${percent}%`;
        
        if (percent === 100) {
            splashStatusText.innerText = "GPUメモリへ展開中... (数秒かかります)";
        } else {
            splashStatusText.innerText = initProgress.text;
        }
    };

    try {
        // Mark as loading to detect crashes
        const crashKey = `crash_detect_${modelName}`;
        const loadCount = parseInt(localStorage.getItem(crashKey) || "0");
        
        if (loadCount > 0) {
            splashSubtext.innerText = "前回の起動時にクラッシュした可能性があります。より軽量なモデル（Llama 3.2 1Bなど）への変更を推奨します。";
            splashLoadingArea.classList.remove('opacity-0');
            splashChangeModelBtn.classList.add('animate-bounce', 'text-blue-400', 'border-blue-400');
        }
        
        localStorage.setItem(crashKey, (loadCount + 1).toString());

        // Dynamic Loading
        await loadAiLibraries();
        const myAppConfig = await getAppConfig();

        // Initialize engine with expanded context window for better coherence
        engine = await CreateMLCEngine(modelName, { 
            appConfig: myAppConfig,
            initProgressCallback,
            chatOpts: {
                context_window_size: 4096 // Increased from 2048 for better accuracy
            }
        });
        engine.activeModel = modelName;
        
        // Update header display
        const modelSelect = document.getElementById('modelNameInput');
        const selectedOption = Array.from(modelSelect.options).find(opt => opt.value === modelName);
        if (selectedOption) {
            // Extract just the model name part (e.g., "Gemma 4 E4B") from the option text
            const displayName = selectedOption.text.split('(')[0].replace(/^[^\w]+/, '').trim();
            document.getElementById('currentModelName').innerText = displayName;
        } else {
            document.getElementById('currentModelName').innerText = modelName;
        }
        
        // Success! Clear crash count
        localStorage.removeItem(crashKey);
        
        // Wait for the 3s timer
        await minTimer;
        
        // Hide splash
        splashScreen.classList.add('opacity-0');
        setTimeout(() => splashScreen.remove(), 700);
    } catch (err) {
        console.error("Splash Init Error:", err);
        const errStr = err.message || String(err);
        splashStatusText.innerText = "エンジンの起動に失敗しました";
        
        if (errStr.includes("shader-f16")) {
            splashSubtext.innerText = "お使いのGPUが 'shader-f16' 機能をサポートしていません。別のモデル（Llama 3.2 1Bなど）をお試しください。";
        } else if (errStr.includes("memory") || errStr.includes("buffer") || errStr.includes("Device was lost")) {
            splashSubtext.innerText = "VRAM（ビデオメモリ）不足またはGPUエラーが発生しました。他のタブを閉じるか、軽量モデルを使用してください。";
        } else if (modelName.includes('Llama-3.2') && errStr.includes("not found")) {
            splashSubtext.innerText = "WebLLMの最新バージョンへのアップデート待ちです。別のモデルを選択してください。";
        } else {
            splashSubtext.innerText = `エラー内容: ${errStr.substring(0, 100)}... 設定からモデルを変更してください。`;
        }
        
        splashLoadingArea.classList.remove('opacity-0');
        splashChangeModelBtn.classList.add('animate-bounce', 'text-blue-400', 'border-blue-400', 'border-2');
        
        // Show the persistent error area
        showError(`起動エラー: ${errStr}`);
    }
}

// --- App Initialization ---
function initApp() {
    setupMobileTabs();
    
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.lang = 'ja-JP'; 
        // スマホ(特にAndroid Chrome)ではcontinuous=trueだとisFinalが細切れに連続して発火するバグがあるため無効化する
        recognition.continuous = !isMobile; 
        recognition.interimResults = !isMobile; // Disable interim on mobile for stability
        recognition.maxAlternatives = 1;
        
        recognition.onerror = (event) => {
            console.warn("SpeechRecognition error:", event.error);
            if (event.error === 'not-allowed' || event.error === 'audio-capture') {
                showError("ERR: マイクへのアクセスが拒否されたか、利用できません。");
                if(isRecording) toggleRecording(); // Stop UI
            }
        };

        recognition.onresult = (event) => {
            let interim = '';
            const currentTime = document.getElementById('timerDisplay').innerText;

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const res = event.results[i];
                if (res.isFinal) {
                    const text = res[0].transcript.trim();
                    if (!text) continue; 
                    
                    const timestampStr = `[${currentTime}] `;
                    
                    // モバイル等のバグで細切れのテキストが連続で送信される場合の重複・成長テキストを統合する
                    let isMerged = false;
                    if (finalTranscript.length > 0) {
                        const lines = finalTranscript.trimEnd().split('\n');
                        const lastLine = lines[lines.length - 1];
                        const match = lastLine.match(/^\[.*?\] (.*)$/);
                        
                        if (match) {
                            const lastContent = match[1];
                            // 新しいテキストが直前のテキストを含んで成長している場合、最後の行を上書きする
                            // "戻っ" -> "戻って" -> "戻ってき" のようなケースに対応
                            if (text.startsWith(lastContent)) {
                                lines[lines.length - 1] = timestampStr + text;
                                finalTranscript = lines.join('\n') + '\n';
                                isMerged = true;
                            } else if (lastContent === text) {
                                // 完全一致する重複送信は無視する
                                isMerged = true;
                            }
                        }
                    }
                    
                    if (!isMerged) {
                        finalTranscript += timestampStr + text + '\n';
                    }
                    
                    localStorage.setItem('local_ai_assistant_text', finalTranscript);
                    
                    // Limit text size in localStorage to avoid crash
                    if (finalTranscript.length > 500000) {
                       localStorage.setItem('local_ai_assistant_text', finalTranscript.substring(finalTranscript.length - 500000));
                    }
                    
                    // Add to buffer for real-time AI processing if enabled
                    const isRealtimeEnabled = document.getElementById('realtimeAiToggle')?.checked;
                    if (isRealtimeEnabled) {
                        realtimeAiBuffer += text + ' ';
                        processRealtimeAI();
                    }
                } else {
                    interim += res[0].transcript;
                }
            }
            interimTranscript = interim;
            updateTranscriptionUI();
        };

        recognition.onend = () => { 
            if (isRecording) { 
                // Restart recognition to overcome timeout
                setTimeout(() => {
                    if (isRecording) {
                        try { recognition.start(); } catch (e) {} 
                    }
                }, 300);
            } 
        };
    } else {
        showError("ERR: このブラウザは音声認識をサポートしていません。Chromeをご利用ください。");
        document.getElementById('recBtn').disabled = true;
    }
}

async function updateMicList() {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        const select = document.getElementById('micSelect');
        select.innerHTML = '<option value="">システム標準マイク</option>';
        audioInputs.forEach(device => {
            if (device.deviceId !== 'default' && device.deviceId !== 'communications') {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `マイク ${select.length}`;
                select.appendChild(option);
            }
        });
    } catch (err) { console.warn("マイク一覧取得失敗:", err); }
}

async function requestWakeLock() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {}
}
function releaseWakeLock() { if (wakeLock) { wakeLock.release().then(()=>wakeLock=null).catch(()=>{}); } }
function showError(msg) { 
    const area = document.getElementById('sysErrorArea');
    if (!area) return;
    area.classList.remove('hidden'); 
    document.getElementById('sysErrorText').innerText = msg; 
}

function setupMobileTabs() {
    const tabTranscription = document.getElementById('mobileTabTranscription');
    const tabAi = document.getElementById('mobileTabAi');
    const viewTranscription = document.getElementById('leftSection');
    const viewAi = document.getElementById('rightSection');

    if (!tabTranscription || !tabAi || !viewTranscription || !viewAi) return;

    tabTranscription.addEventListener('click', () => {
        tabTranscription.classList.add('text-blue-400', 'border-blue-400');
        tabTranscription.classList.remove('text-slate-500', 'border-transparent');
        tabAi.classList.remove('text-emerald-400', 'border-emerald-400');
        tabAi.classList.add('text-slate-500', 'border-transparent');
        
        viewTranscription.classList.remove('hidden');
        viewAi.classList.add('hidden');
        viewTranscription.classList.add('flex');
    });

    tabAi.addEventListener('click', () => {
        tabAi.classList.add('text-emerald-400', 'border-emerald-400');
        tabAi.classList.remove('text-slate-500', 'border-transparent');
        tabTranscription.classList.remove('text-blue-400', 'border-blue-400');
        tabTranscription.classList.add('text-slate-500', 'border-transparent');
        
        viewAi.classList.remove('hidden');
        viewTranscription.classList.add('hidden');
        viewTranscription.classList.remove('flex');
        viewAi.classList.add('flex');
    });
    
    // Initial check for mobile to trigger flex/hidden
    if (window.innerWidth < 1024) {
        tabTranscription.click();
    }
}

// --- Recording Logic ---
async function toggleRecording() {
    const recBtn = document.getElementById('recBtn');
    const recBtnText = document.getElementById('recBtnText');
    const micSelect = document.getElementById('micSelect');
    const recIndicator = document.getElementById('recIndicator');

    if (isRecording) {
        // Stop Recording
        isRecording = false; clearInterval(timerInterval); releaseWakeLock();
        
        recBtn.classList.remove('bg-red-600', 'hover:bg-red-700', 'recording-pulse');
        recBtn.classList.add('bg-blue-600', 'hover:bg-blue-700');
        recBtn.innerHTML = '<i data-lucide="mic" class="w-6 h-6"></i> <span>録音開始</span>';
        recIndicator.classList.remove('bg-red-500', 'animate-pulse', 'shadow-[0_0_15px_rgba(239,68,68,0.6)]');
        recIndicator.classList.add('bg-slate-600', 'shadow-[0_0_8px_rgba(71,85,105,0.4)]');
        lucide.createIcons();
        
        micSelect.disabled = false;
        
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop(); mediaRecorder.stream.getTracks().forEach(t => t.stop());
        }
        if (recognition) {
            try { recognition.stop(); } catch(e){}
            
            if (interimTranscript) {
                finalTranscript += `[${document.getElementById('timerDisplay').innerText}] ${interimTranscript}\n`;
                interimTranscript = ''; 
            }
            updateTranscriptionUI();
            saveSession();
        }

        setTimeout(() => {
            if(audioChunks.length > 0) {
                const mimeType = mediaRecorder ? mediaRecorder.mimeType : 'audio/webm';
                currentAudioBlob = new Blob(audioChunks, { type: mimeType });
                document.getElementById('downloadAudioBtn').disabled = false;
            }
        }, 200);

    } else {
        // Start Recording
        try {
            const selectedMicId = micSelect.value;
            let audioConstraints = true;
            if (selectedMicId) {
                audioConstraints = { deviceId: { exact: selectedMicId } };
            }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
            
            mediaRecorder = new MediaRecorder(stream); 
            audioChunks = []; currentAudioBlob = null;
            document.getElementById('downloadAudioBtn').disabled = true;
            document.getElementById('sysErrorArea').classList.add('hidden');
            await requestWakeLock();

            if (recognition) { try { currentSessionMap.clear(); recognition.start(); } catch(e){} }
            mediaRecorder.ondataavailable = (e) => { 
                if (e.data.size > 0) {
                    audioChunks.push(e.data); 
                    if (db) {
                        const mimeType = mediaRecorder ? mediaRecorder.mimeType : 'audio/webm';
                        const backupBlob = new Blob(audioChunks, { type: mimeType });
                        const tx = db.transaction('backups', 'readwrite');
                        tx.objectStore('backups').put({ id: 'latest_audio', blob: backupBlob });
                    }
                }
            };
            mediaRecorder.start(1000); isRecording = true;
            
            recBtn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
            recBtn.classList.add('bg-red-600', 'hover:bg-red-700', 'recording-pulse');
            recBtn.innerHTML = '<i data-lucide="square" class="w-6 h-6 fill-current"></i> <span>録音停止</span>';
            recIndicator.classList.remove('bg-slate-600', 'shadow-[0_0_8px_rgba(71,85,105,0.4)]');
            recIndicator.classList.add('bg-red-500', 'animate-pulse', 'shadow-[0_0_15px_rgba(239,68,68,0.6)]');
            lucide.createIcons();
            
            micSelect.disabled = true; 
            document.getElementById('transcriptionPlaceholder').style.display = 'none';

            startTime = Date.now();
            timerInterval = setInterval(() => {
                const t = Math.floor((Date.now() - startTime) / 1000);
                const h = String(Math.floor(t / 3600)).padStart(2, '0'), m = String(Math.floor((t % 3600) / 60)).padStart(2, '0'), s = String(t % 60).padStart(2, '0');
                document.getElementById('timerDisplay').innerText = `${h}:${m}:${s}`;
            }, 1000);
        } catch (err) { showError(`ERR [${err.name}]: マイク起動失敗。`); }
    }
}

function updateTranscriptionUI() {
    const fullText = finalTranscript;
    
    // Highlight manual/important memos with bold and color
    const escapedText = fullText.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
    const highlighted = escapedText.replace(/\[\d{2}:\d{2}(?::\d{2})?\] 【重要メモ】.*$/gm, (match) => {
        return `<span class="memo-highlight block my-1.5 p-3 rounded-lg border-2 border-amber-500/40 bg-amber-500/10 font-bold shadow-sm shadow-amber-900/20">${match}</span>`;
    });

    document.getElementById('transcriptionDisplay').innerHTML = highlighted;
    document.getElementById('interimDisplay').innerText = interimTranscript;
    
    if (fullText || interimTranscript) {
        document.getElementById('transcriptionPlaceholder').style.display = 'none';
        document.getElementById('downloadTransBtn').disabled = false;
    }
    
    const container = document.getElementById('viewTranscription'); 
    container.scrollTop = container.scrollHeight;
    
    localStorage.setItem('local_ai_assistant_text', finalTranscript);
}

// --- WebLLM Logic ---
async function generateSummary() {
    if (!finalTranscript) {
        alert("文字起こしデータがありません。先に録音を行ってください。");
        return;
    }

    const modelName = document.getElementById('modelNameInput').value || 'gemma-2-2b-it-q4f16_1-MLC';
    const selectedTasks = Array.from(document.querySelectorAll('input[name="aiTask"]:checked')).map(cb => cb.value);
    
    if (selectedTasks.length === 0) {
        alert("実行するAIタスクを選択してください。");
        return;
    }

    const length = document.getElementById('aiLengthSelect').value;
    const tone = document.getElementById('aiToneSelect').value;

    document.getElementById('summaryPlaceholder').classList.add('hidden');
    document.getElementById('summaryDisplay').classList.remove('hidden');
    document.getElementById('summaryDisplay').innerHTML = "";
    document.getElementById('aiActionFooter').classList.add('hidden');
    
    const loadingIndicator = document.getElementById('loadingIndicator');
    const progressContainer = document.getElementById('downloadProgressContainer');
    
    loadingIndicator.classList.remove('hidden');
    document.getElementById('generateBtn').disabled = true;
    isProcessingAI = true;

    try {
        // Initialize or Reload Engine if model changed
        if (!engine || engine.activeModel !== modelName) {
            loadingIndicator.classList.remove('hidden');
            progressContainer.classList.remove('hidden');
            
            const initProgressCallback = (initProgress) => {
                const progressPercent = Math.round(initProgress.progress * 100);
                document.getElementById('downloadProgressBar').style.width = `${progressPercent}%`;
            };

            if (engine) {
                try { await engine.unload(); } catch (e) {}
            }

            await loadAiLibraries();
            const myAppConfig = await getAppConfig();
            engine = await CreateMLCEngine(modelName, { 
                appConfig: myAppConfig,
                initProgressCallback: initProgressCallback,
                chatOpts: { context_window_size: 4096 }
            });
            engine.activeModel = modelName;
        }

        loadingIndicator.classList.add('hidden');
        const summaryDisplay = document.getElementById('summaryDisplay');

        // Combined Context Header
        const lengthText = length === 'short' ? '簡潔に（箇条書きメイン）' : (length === 'long' ? '詳細に（網羅的）' : '標準的な長さで');
        const toneText = tone === 'formal' ? 'ですます調・ビジネス敬語' : (tone === 'informal' ? '親しみやすい口調' : '中立的な表現');

        let accumulatedResults = "";

        for (const task of selectedTasks) {
            let prompt = "";
            let taskTitle = "";

            const contextFlavor = `【出力設定】
トーン: ${toneText}
長さ: ${lengthText}

【厳守事項】
1. 与えられた文字起こしデータの内容に忠実に基づき、推測や嘘を混ぜないでください。
2. 文脈が不明瞭な部分は無理に解釈せず、そのまま残すか、不明である旨を記載してください。
3. 日本語の音声認識特有の誤変換（同音異義語など）を文脈から適切に判断して修正してください。`;

            if (task === 'correction') {
                taskTitle = "文字起こし補正";
                prompt = `あなたはプロの編集者です。以下の文字起こしデータの誤字脱字、音声認識エラー（カタカナの誤変換や助詞の抜け）を修正し、読みやすい文章に整えてください。
${contextFlavor}

[文字起こしデータ]
${finalTranscript}`;
            } else if (task === 'minutes') {
                taskTitle = "議事録作成";
                prompt = `あなたは優秀な秘書です。以下の内容から、議論の要点、決定事項、および次回への課題を整理した議事録を作成してください。
${contextFlavor}

[会議内容]
${finalTranscript}`;
            } else if (task === 'todo') {
                taskTitle = "TODO抽出";
                prompt = `あなたはタスク管理の専門家です。以下の内容から、今後実行すべきアクション（TODO）を抽出してください。
「誰が」「いつまでに」「何を」するのかがわかるようにリストアップしてください。不明な項目は「要確認」として扱ってください。
${contextFlavor}

[内容]
${finalTranscript}`;
            }

            // UI Section
            const section = document.createElement('div');
            section.className = "mb-10 animate-in fade-in slide-in-from-bottom-4 duration-500";
            section.innerHTML = `
                <div class="flex items-center gap-3 mb-4">
                    <span class="text-[10px] font-black bg-emerald-500 text-slate-950 px-2 py-0.5 rounded uppercase tracking-tighter">${taskTitle}</span>
                    <div class="h-px flex-1 bg-slate-800"></div>
                </div>
                <div class="task-content markdown-body text-slate-100 leading-relaxed min-h-[50px]"></div>
            `;
            summaryDisplay.appendChild(section);

            const contentDiv = section.querySelector('.task-content');
            const messages = [{ role: "user", content: prompt }];
            
            const chunks = await engine.chat.completions.create({ 
                messages, 
                stream: true,
                temperature: 0.2, // Lowered for higher factuality
                repetition_penalty: 1.15,
                max_tokens: 2048
            });

            let reply = "";
            for await (const chunk of chunks) {
                const content = chunk.choices[0]?.delta?.content || "";
                reply += content;
                if (content && markedInstance) {
                    contentDiv.innerHTML = markedInstance.parse(reply);
                    document.getElementById('aiAnalysisResultsArea').scrollTop = document.getElementById('aiAnalysisResultsArea').scrollHeight;
                }
            }
            accumulatedResults += `## ${taskTitle}\n\n${reply}\n\n---\n\n`;
        }

        document.getElementById('aiActionFooter').classList.remove('hidden');
        saveSession();

    } catch (error) {
        console.error("WebLLM Error:", error);
        summaryDisplay.innerHTML = `<div class="p-6 bg-red-900/20 border border-red-800 rounded-2xl text-red-200">AI処理中にエラーが発生しました: ${error.message}</div>`;
    } finally {
        loadingIndicator.classList.add('hidden');
        document.getElementById('generateBtn').disabled = false;
        isProcessingAI = false;
    }
}

async function processRealtimeAI() {
    // Increase buffer requirement to 100 chars for overall context
    if (!engine || isRealtimeProcessing || realtimeAiBuffer.length < 100) return;
    
    const isRealtimeEnabled = document.getElementById('realtimeAiToggle');
    if (isRealtimeEnabled && !isRealtimeEnabled.checked) {
        realtimeAiBuffer = ''; // Clear buffer if disabled
        return;
    }
    
    isRealtimeProcessing = true;
    realtimeAiBuffer = ''; // Reset accumulation buffer
    
    try {
        // Extract all manual memos for high priority context
        const manualMemos = (finalTranscript.match(/\[.*?\] 【重要メモ】.*?\n/g) || []).join('\n');
        // Take last 2000 characters of transcription for context window
        const recentTranscript = finalTranscript.slice(-2000);

        const prompt = `あなたはプロの会議要約アシスタントです。
これまでの会議の流れをリアルタイムで追跡し、現在の「全体要約」を最新の状態に更新してください。

【出力のガイドライン】
1. **正確性優先**: 文字起こしデータにない情報を捏造しないでください。
2. **情報の重要度**: ユーザーが記録した「重要メモ」の内容は、最優先で要約に反映させてください。
3. **簡潔さ**: 構造化された箇条書きを使用し、数秒で状況が把握できるようにしてください。
4. **ノイズ除去**: 談笑やフィラー（えー、あの等）は要約から除外してください。

--- 会議の進行状況 (現在の文字起こし) ---
${recentTranscript}

--- ユーザー指定の重要事項 (最優先) ---
${manualMemos || "（特になし）"}

--- 現時点までの要約 (箇条書き) ---`;

        const messages = [{ role: "user", content: prompt }];
        const chunks = await engine.chat.completions.create({ 
            messages, 
            stream: true,
            temperature: 0.1, 
            max_tokens: 600
        });

        const realtimeDisplay = document.getElementById('realtimeAiDisplay');
        const placeholder = document.getElementById('realtimePlaceholder');
        if (placeholder) placeholder.classList.add('hidden');
        realtimeDisplay.classList.remove('hidden');

        // We use a single overall update block
        let summaryContainer = document.getElementById('overallRealtimeSummary');
        if (!summaryContainer) {
            summaryContainer = document.createElement('div');
            summaryContainer.id = 'overallRealtimeSummary';
            summaryContainer.className = 'bg-emerald-950/20 p-4 rounded-lg border border-emerald-500/30';
            realtimeDisplay.innerHTML = ''; // Clear old blocks
            realtimeDisplay.appendChild(summaryContainer);
        }

        const sessionTime = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        summaryContainer.innerHTML = `
            <div class="text-[10px] font-bold text-emerald-400/60 mb-2 flex items-center gap-1 uppercase tracking-tighter">
                <i data-lucide="refresh-cw" class="w-3 h-3 animate-spin"></i> 随時更新中の全体要約 (最終更新: ${sessionTime})
            </div>
            <div class="content whitespace-pre-wrap break-words text-emerald-50 text-sm leading-relaxed"></div>
        `;
        lucide.createIcons();
        
        const contentDiv = summaryContainer.querySelector('.content');

        let reply = "";
        for await (const chunk of chunks) {
            const content = chunk.choices[0]?.delta?.content || "";
            reply += content;
            if (content) {
                contentDiv.innerText = reply;
                // Don't auto-scroll to bottom of display, let user read if they want
            }
        }
    } catch (e) {
        console.warn("Real-time AI Error:", e);
    } finally {
        isRealtimeProcessing = false;
        // If more text accumulated, check again later
    }
}

// --- Utility ---
async function handleSave(blob, ext, desc) {
    if (!blob) return;
    const filename = `AudioLog_${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}${String(new Date().getDate()).padStart(2,'0')}${ext}`;
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: desc, accept: { '*/*': [ext] } }] });
            const writable = await handle.createWritable(); await writable.write(blob); await writable.close(); return;
        } catch (e) { if (e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

function downloadAiOutput() {
    const summaryDisplay = document.getElementById('summaryDisplay');
    const content = summaryDisplay.innerText;
    const blob = new Blob([content], { type: 'text/plain' });
    handleSave(blob, '.txt', 'AI分析結果');
}
