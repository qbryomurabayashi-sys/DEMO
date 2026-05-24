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
dbReq.onerror = (e) => {
    console.error("Database failed to open:", e.target.error);
    alert("データベースの初期化に失敗しました。プライベートブラウジングモードなど、履歴の保存に制限がある可能性があります。履歴への保存機能は無効になります。");
};

// Help helper to update session text in background
function updateSessionTextInDB(id, text) {
    if (!db) return;
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    store.get(id).onsuccess = (e) => {
        const session = e.target.result;
        if (session) {
            session.text = text;
            store.put(session).onsuccess = () => {
                console.log("Session text auto-updated in DB.");
            };
        }
    };
}

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
let lastStartTimestamp = 0;

function updateSpeechStatus(status, text) {
    const badge = document.getElementById('speechStatusBadge');
    const dot = document.getElementById('speechStatusDot');
    const statusText = document.getElementById('speechStatusText');
    if (!badge || !dot || !statusText) return;
    
    badge.className = "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium transition-all duration-300 border";
    dot.className = "w-1.5 h-1.5 rounded-full";
    
    statusText.innerText = `音声認識: ${text}`;
    
    switch (status) {
        case 'inactive':
            badge.classList.add('bg-slate-800', 'text-slate-400', 'border-slate-750/80');
            dot.classList.add('bg-slate-500');
            break;
        case 'starting':
            badge.classList.add('bg-amber-500/10', 'text-amber-400', 'border-amber-500/20');
            dot.classList.add('bg-amber-500', 'animate-pulse');
            break;
        case 'listening':
            badge.classList.add('bg-emerald-500/10', 'text-emerald-400', 'border-emerald-500/20');
            dot.classList.add('bg-emerald-500', 'animate-pulse');
            break;
        case 'processing':
            badge.classList.add('bg-blue-500/10', 'text-blue-400', 'border-blue-500/20');
            dot.classList.add('bg-blue-500', 'animate-pulse');
            break;
        case 'reconnecting':
            badge.classList.add('bg-amber-500/10', 'text-amber-400', 'border-amber-500/20');
            dot.classList.add('bg-amber-500', 'animate-pulse');
            break;
        case 'error':
        case 'unsupported':
            badge.classList.add('bg-red-500/10', 'text-red-400', 'border-red-500/20');
            dot.classList.add('bg-red-500');
            break;
    }
}

// Dynamic check for browser audio formats to prevent Safari/iOS crashes
function getSupportedMimeType() {
    const types = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/mp4',
        'audio/aac',
        'audio/wav'
    ];
    for (const type of types) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) {
            return type;
        }
    }
    return ''; // Fallback to browser default
}

// Reusable custom async confirm modal
function customConfirm(title, message, isDangerous = false) {
    return new Promise((resolve) => {
        const modal = document.getElementById('customConfirmModal');
        const titleEl = document.getElementById('confirmTitle');
        const messageEl = document.getElementById('confirmMessage');
        const confirmBtn = document.getElementById('confirmConfirmBtn');
        const cancelBtn = document.getElementById('cancelConfirmBtn');
        const iconBox = document.getElementById('confirmIconBox');
        
        titleEl.innerText = title;
        messageEl.innerHTML = message.replace(/\n/g, '<br>');
        
        if (isDangerous) {
            confirmBtn.className = "px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm font-bold transition shadow-lg shadow-red-900/40";
            iconBox.className = "bg-red-500/10 p-2.5 rounded-xl border border-red-500/20 text-red-500";
        } else {
            confirmBtn.className = "px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold transition shadow-lg shadow-blue-900/40";
            iconBox.className = "bg-blue-500/10 p-2.5 rounded-xl border border-blue-500/20 text-blue-500";
        }
        
        document.body.classList.add('modal-active');
        modal.classList.remove('hidden');
        safeCreateIcons();
        
        const onConfirm = () => {
            cleanup();
            resolve(true);
        };
        const onCancel = () => {
            cleanup();
            resolve(false);
        };
        
        function cleanup() {
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            modal.classList.add('hidden');
            document.body.classList.remove('modal-active');
        }
        
        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    });
}

// Generic custom async prompt modal for title inputs
function customPrompt(heading, labelText, defaultVal) {
    return new Promise((resolve) => {
        const modal = document.getElementById('saveSessionModal');
        const titleEl = modal.querySelector('h3');
        const labelEl = modal.querySelector('label');
        const input = document.getElementById('sessionTitleInput');
        const confirmBtn = document.getElementById('confirmSaveBtn');
        const cancelBtn = document.getElementById('cancelSaveBtn');
        
        titleEl.innerText = heading;
        labelEl.innerText = labelText;
        input.value = defaultVal;
        
        document.body.classList.add('modal-active');
        modal.classList.remove('hidden');
        input.focus();
        input.select();
        
        const onConfirm = () => {
            const val = input.value.trim();
            cleanup();
            resolve(val);
        };
        const onCancel = () => {
            cleanup();
            resolve(null);
        };
        const onKeyPress = (e) => {
            if (e.key === 'Enter') {
                onConfirm();
            }
        };
        
        function cleanup() {
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('keypress', onKeyPress);
            modal.classList.add('hidden');
            document.body.classList.remove('modal-active');
        }
        
        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        input.addEventListener('keypress', onKeyPress);
    });
}

// Guidance Modal for Mic permissions
function showMicPermissionModal() {
    const modal = document.getElementById('micPermissionModal');
    const closeBtn = document.getElementById('closePermissionModalBtn');
    
    const isIframe = window.self !== window.top;
    const warningBox = document.getElementById('iframeWarningBox');
    if (warningBox) {
        if (isIframe) {
            warningBox.classList.remove('hidden');
        } else {
            warningBox.classList.add('hidden');
        }
    }
    
    document.body.classList.add('modal-active');
    modal.classList.remove('hidden');
    safeCreateIcons();
    
    const onClose = () => {
        modal.classList.add('hidden');
        document.body.classList.remove('modal-active');
        closeBtn.removeEventListener('click', onClose);
    };
    
    closeBtn.addEventListener('click', onClose);
}

// Initialize Lucide Icons globally for static HTML
function safeCreateIcons() {
    try {
        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
        }
    } catch (e) {
        console.warn("Lucide auto-render failed, will call manually where needed.", e);
    }
}
safeCreateIcons();

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

// Ensure Web Speech API is maximally optimized and resilient
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        updateSpeechStatus('unsupported', '非対応ブラウザ');
        return null;
    }
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'ja-JP';
    rec.maxAlternatives = 1;

    let speechStallTimeout = null;

    function resetStallTimeout() {
        if (speechStallTimeout) clearTimeout(speechStallTimeout);
        speechStallTimeout = setTimeout(() => {
            if (isRecording && rec) {
                console.log("Speech recognition appears stalled. Forcing restart...");
                try {
                    updateSpeechStatus('reconnecting', '無音検出による再起動中');
                    rec.stop();
                } catch(e){}
            }
        }, 15000); // 15 seconds of absolute silence triggers a restart
    }

    rec.onstart = () => {
        console.log("Speech recognition started");
        const errDisp = document.getElementById('sysErrorArea');
        if (errDisp) errDisp.classList.add('hidden');
        interimTranscript = "(音声を聞き取っています...)";
        updateTranscriptionUI();
        resetStallTimeout();
        updateSpeechStatus('listening', '聞き取り中');
    };

    rec.onaudiostart = () => console.log('Audio capturing started');
    rec.onsoundstart = () => {
        console.log('Sound started');
        updateSpeechStatus('listening', '音声を検出中');
    };
    rec.onspeechstart = () => {
        console.log('Speech started');
        updateSpeechStatus('processing', '解析中');
    };
    rec.onspeechend = () => {
        console.log('Speech ended');
        updateSpeechStatus('listening', '解析完了・次の発話待ち');
    };
    rec.onsoundend = () => {
        console.log('Sound ended');
        resetStallTimeout();
        updateSpeechStatus('listening', '静音中');
    };
    rec.onaudioend = () => console.log('Audio capturing ended');
    rec.onnomatch = () => console.log('No match');

    rec.onresult = (event) => {
        resetStallTimeout();
        console.log("Speech recognition result received", event.results);
        updateSpeechStatus('processing', '文字変換中');
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
        
        if (event.error === 'no-speech' || event.error === 'aborted') {
            // Ignore these non-fatal errors during silence or resets
            return;
        }

        const errDisp = document.getElementById('sysErrorArea');
        const errText = document.getElementById('sysErrorText');
        
        if (event.error === 'not-allowed') {
            // Permission denied: fatal. Stop recording, show guidance modal
            updateSpeechStatus('error', 'マイク権限エラー');
            if (errDisp && errText) {
                errDisp.classList.remove('hidden');
                const isIframe = window.self !== window.top;
                if (isIframe) {
                    errText.innerHTML = '<strong>【重要】マイクへのアクセス拒否について</strong><br>現在はプレビュー画面で実行されているため、ブラウザのセキュリティ制限によりマイクがブロックされています。<br><strong>右上の「新しいタブで開く」アイコンから起動し直してください。</strong>';
                } else {
                    errText.innerText = "マイクへのアクセスが拒否されました。ブラウザの設定でマイクを「許可」してリロードしてください。";
                }
            }
            showMicPermissionModal();
            stopRecording();
        } else if (event.error === 'network') {
            // Network error: NON-FATAL! Do NOT stop mediaRecorder, just alert visually and let onend restart it
            console.warn("Speech recognition network error. Keep recording. SpeechRecognition will restart.");
            updateSpeechStatus('reconnecting', '再接続中(ネットワークエラー)');
            interimTranscript = "(ネットワーク一時接続切れ - 文字起こし自動再接続中...)";
            updateTranscriptionUI();
        } else {
            // Other errors: NON-FATAL. Do NOT stop mediaRecorder.
            console.warn("Non-fatal speech recognition error: " + event.error + ". Keep recording.");
            updateSpeechStatus('reconnecting', `再接続中(${event.error})`);
            interimTranscript = `(音声認識が一時的に利用不可: ${event.error} - 録音は継続中...)`;
            updateTranscriptionUI();
        }
    };

    rec.onend = () => {
        // Keep restarting speech recognition as long as isRecording is true
        if (isRecording) {
            console.log("Speech recognition ended. Attempting throttled automatic restart...");
            const now = Date.now();
            const elapsed = now - lastStartTimestamp;
            // Limit restarts to once every 3.5 seconds to prevent rate-limit loop freeze
            const delay = elapsed < 3500 ? 3500 - elapsed : 500;
            
            setTimeout(() => {
                if (isRecording) {
                    try {
                        console.log("Throttled SpeechRecognition restart triggered");
                        lastStartTimestamp = Date.now();
                        rec.start();
                    } catch (e) {
                        console.error("Failed to restart recognition:", e);
                    }
                }
            }, delay);
        } else {
            updateSpeechStatus('inactive', '待機中');
        }
    };

    return rec;
}

function updateTranscriptionUI() {
    const display = document.getElementById('transcriptionDisplay');
    const placeholder = document.getElementById('transcriptionPlaceholder');
    const interimDisp = document.getElementById('interimDisplay');
    
    if (finalTranscript || interimTranscript && !interimTranscript.startsWith('(')) {
        placeholder.style.display = 'none';
        
        let escapedText = finalTranscript.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
        const highlighted = escapedText
            .replace(/\[\d{2}:\d{2}(?::\d{2})?\] 【重要メモ】.*$/gm, (match) => {
                return `<span class="memo-highlight block my-1.5 p-3 rounded-lg border-2 border-amber-500/40 bg-amber-500/10 font-bold shadow-sm shadow-amber-900/20 text-amber-100">${match}</span>`;
            })
            .replace(/\n/g, '<br>');

        display.innerHTML = highlighted;
        interimDisp.innerText = interimTranscript;
        
        // Auto scroll
        const container = document.getElementById('viewTranscription');
        container.scrollTop = container.scrollHeight;
    } else {
        const isIframe = window.self !== window.top;
        if (isRecording) {
            placeholder.innerHTML = `
              <i data-lucide="mic" class="w-12 h-12 mb-4 text-blue-500 animate-pulse"></i>
              <p class="text-sm font-bold uppercase tracking-widest mb-1 text-blue-400">録音中...</p>
              ${isIframe ? '<p class="text-xs text-amber-400 font-bold mt-2 bg-amber-900/30 p-2 rounded">【重要】プレビュー画面ではブラウザの制限で文字起こしが出ない場合があります。<br>右上の「新しいタブで開く」アイコンから起動してください。</p>' : '<p class="text-[10px] text-slate-400 mt-2">音声を検出しています。しばらく声を出してみてください。</p>'}
            `;
            placeholder.style.display = 'flex';
            placeholder.classList.remove('opacity-40');
            safeCreateIcons();
            
            interimDisp.innerText = interimTranscript; // Show the waiting message
        } else {
            placeholder.innerHTML = `
              <i data-lucide="activity" class="w-12 h-12 mb-4"></i>
              <p class="text-sm font-bold uppercase tracking-widest mb-1">録音準備完了</p>
              ${isIframe ? '<p class="text-xs text-amber-400 mt-2">※右上のアイコンから別タブで開くと文字起こしが安定します</p>' : '<p class="text-[10px] mt-2">上のボタンから録音を開始してください</p>'}
            `;
            placeholder.style.display = 'flex';
            placeholder.classList.add('opacity-40');
            safeCreateIcons();
        }
        display.innerHTML = '';
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
    if (!navigator || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        micSelect.innerHTML = '<option value="">マイク情報を取得できません(非推奨ブラウザ/セキュア接続なし)</option>';
        return;
    }
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
            option.text = device.label || `マイク ${micSelect.options.length + 1}`;
            micSelect.appendChild(option);
        });
        
    } catch (e) {
        console.error("Error accessing media devices", e);
        micSelect.innerHTML = '<option value="">権限が必要です (マイクを許可してください)</option>';
        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError' || (e.message && e.message.includes('Permission denied'))) {
            const errDisp = document.getElementById('sysErrorArea');
            const errText = document.getElementById('sysErrorText');
            if (errDisp && errText) {
                errDisp.classList.remove('hidden');
                const isIframe = window.self !== window.top;
                if (isIframe) {
                    errText.innerHTML = '<strong>【確認のお願い】</strong>現在のプレビュー枠内では<strong>ブラウザの制限</strong>によりマイクにアクセスできない場合があります。画面右上にある「新しいタブで開く」アイコンから別タブで起動してください。';
                } else {
                    errText.innerText = "マイクへのアクセスが拒否されています。ブラウザの設定からマイクの権限を許可してください。";
                }
            }
        }
    }
}

document.getElementById('refreshMicBtn').addEventListener('click', () => populateMicrophones(true));

// Setup recording
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
            const stream = await navigator.mediaDevices.getUserMedia(constraints);

            // Re-init recognition cleanly
            updateSpeechStatus('starting', '音声認識エンジン起動中...');
            recognition = initSpeechRecognition();
            if (recognition) {
                try {
                    lastStartTimestamp = Date.now();
                    recognition.start();
                } catch(e) {
                    console.error("Failed to start recognition:", e);
                }
            } else {
                updateSpeechStatus('unsupported', '非対応ブラウザ（録音のみ）');
                console.warn("Speech recognition is not supported in this browser. Audio recording will continue without live transcription.");
                const errDisp = document.getElementById('sysErrorArea');
                const errText = document.getElementById('sysErrorText');
                if (errDisp && errText) {
                    errDisp.classList.remove('hidden');
                    errText.innerHTML = '<strong>【お知らせ】</strong>お使いのブラウザはリアルタイム文字起こし（Web Speech API）に対応していないため、<strong>音声の録音と手動メモ機能のみ</strong>が利用可能です。文字起こしを使用するには、PCの <strong>Chrome</strong> または <strong>Edge</strong> をご使用ください。';
                }
            }
            
            hideError();
            
            audioChunks = [];
            currentAudioBlob = null;
            finalTranscript = '';
            interimTranscript = '';
            document.getElementById('transcriptionDisplay').innerHTML = '';
            
            // Dynamic MIME type selection to prevent crashes in Safari/Firefox
            const mimeType = getSupportedMimeType();
            const options = mimeType ? { mimeType } : {};
            console.log("Initializing MediaRecorder with mimeType:", mimeType || "default");
            mediaRecorder = new MediaRecorder(stream, options);
            
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };
            
            mediaRecorder.onstop = async () => {
                const actualMimeType = mediaRecorder.mimeType || 'audio/webm';
                currentAudioBlob = new Blob(audioChunks, { type: actualMimeType });
                document.getElementById('downloadAudioBtn').disabled = false;
                
                await promptAndSaveSession(); 
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
            
            safeCreateIcons();
            micSelect.disabled = true;
            
            startTime = Date.now();
            timerInterval = setInterval(() => {
                document.getElementById('timerDisplay').innerText = getFormattedTime(Date.now() - startTime);
            }, 1000);
            
            updateTranscriptionUI();

        } catch (e) {
            console.error("Media error:", e);
            const errDisp = document.getElementById('sysErrorArea');
            const errText = document.getElementById('sysErrorText');
            if (errDisp && errText) {
                errDisp.classList.remove('hidden');
                const isIframe = window.self !== window.top;
                if (e.name === 'NotAllowedError' || (e.message && e.message.includes("Permission denied"))) {
                    if (isIframe) {
                        errText.innerHTML = '<strong>【重要】マイクへのアクセス拒否について</strong><br>現在はAI Studioのプレビュー画面（枠内）で実行されているため、<strong>ブラウザ自体のセキュリティ制限</strong>によりマイクの使用がブロックされています（AIの不具合ではありません）。<br>文字起こしを使用するには、<strong>画面右上にある「新しいタブで開く」アイコンをクリックして、別タブで全画面表示</strong>にしてください。';
                    } else {
                        errText.innerHTML = "マイクへのアクセスが拒否されました。ブラウザのURLバーにある鍵マーク（設定）から、このサイトでのマイク使用を「許可」にして再読み込みしてください。";
                    }
                    showMicPermissionModal();
                } else {
                    errText.innerText = `録音の開始に失敗しました: ${e.message}\nマイクの設定を確認してください。`;
                }
            }
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
    
    updateSpeechStatus('inactive', '待機中');
    
    if (interimTranscript && !interimTranscript.startsWith('(')) {
        finalTranscript += `\n[${document.getElementById('timerDisplay').innerText}] ${interimTranscript}\n`;
    }
    interimTranscript = '';
    
    updateTranscriptionUI();
    
    const recBtn = document.getElementById('recBtn');
    const recIndicator = document.getElementById('recIndicator');
    
    recBtn.classList.remove('bg-red-600', 'hover:bg-red-700');
    recBtn.classList.add('bg-blue-600', 'hover:bg-blue-700');
    recBtn.innerHTML = '<i data-lucide="mic" class="w-4 h-4"></i> <span>録音開始</span>';
    recIndicator.classList.remove('bg-red-500', 'animate-pulse', 'shadow-[0_0_15px_rgba(239,68,68,0.6)]');
    recIndicator.classList.add('bg-slate-600');
    
    safeCreateIcons();
    document.getElementById('micSelect').disabled = false;
}

// Data flow using custom async prompt modal
async function promptAndSaveSession() {
    if (!finalTranscript.trim() && !currentAudioBlob) return;
    
    const defaultTitle = new Date().toLocaleString() + " の会議";
    const userTitle = await customPrompt("セッションの保存", "会議のタイトル", defaultTitle);
    
    if (userTitle !== null && userTitle.trim() !== "") {
        saveSessionToDB(userTitle.trim());
    } else {
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
        
        safeCreateIcons();
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
            
            // Reset timer text
            document.getElementById('timerDisplay').innerText = "00:00:00";
            
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
    store.get(id).onsuccess = async (e) => {
        const session = e.target.result;
        if (!session) return;
        
        const newTitle = await customPrompt("タイトルの編集", "新しいタイトル", session.title);
        if (newTitle && newTitle.trim() !== "") {
            session.title = newTitle.trim();
            const wTx = db.transaction('sessions', 'readwrite');
            wTx.objectStore('sessions').put(session).onsuccess = () => {
                loadHistory(); 
            };
        }
    };
}

async function deleteSession(id) {
    const confirmed = await customConfirm(
        "セッションの削除",
        "この保存済みセッションを削除しますか？\n(削除したデータは元に戻すことはできません)",
        true
    );
    
    if(confirmed) {
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
    // Check for local file protocol security restriction
    if (window.location.protocol === 'file:') {
        updateSpeechStatus('error', '制限（ローカル起動）');
        const errDisp = document.getElementById('sysErrorArea');
        const errText = document.getElementById('sysErrorText');
        if (errDisp && errText) {
            errDisp.classList.remove('hidden');
            errText.innerHTML = '<strong>【制限】ローカルファイル（file://）として直接開かれています</strong><br>ブラウザのセキュリティ制限により、このファイルダブルクリック起動方法では音声の録音や文字起こしが正常に動作しません。<br><strong>本製品を使用するには、Viteの開発サーバーを起動するか、ローカルWEBサーバー経由でアクセスしてください。</strong>';
        }
    } else {
        populateMicrophones(false);
    }

    document.getElementById('recBtn').addEventListener('click', toggleRecording);
    
    // Buttons
    document.getElementById('clearDataBtn').addEventListener('click', async () => {
        const confirmed = await customConfirm(
            "表示のクリア",
            "画面上のテキストと直近の音声を消去しますか？\n※履歴に保存済みのデータは削除されません。",
            false
        );
        if(confirmed) {
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
    
    // New Session Button binding
    document.getElementById('newSessionBtn').addEventListener('click', async () => {
        if (isRecording) {
            alert("録音中は新規セッションに切り替えることはできません。");
            return;
        }
        const confirmed = await customConfirm(
            "新規セッションの開始",
            "現在の画面表示をリセットし、新しい文字起こしセッションを開始しますか？\n（すでに履歴に保存されているデータは消えません）",
            false
        );
        if (confirmed) {
            finalTranscript = '';
            interimTranscript = '';
            currentAudioBlob = null;
            currentSessionId = null;
            updateTranscriptionUI();
            loadHistory();
            document.getElementById('timerDisplay').innerText = "00:00:00";
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
        
        // Auto-save memo to IndexedDB if view session exists
        if (currentSessionId && db) {
            updateSessionTextInDB(currentSessionId, finalTranscript);
        }
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
