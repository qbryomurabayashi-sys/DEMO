<!DOCTYPE html>
<html lang="ja" translate="no">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>ローカルAI議事録アシスタント (WebLLM)</title>

    <!-- PWA Meta Tags -->
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#0f172a">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="AI議事録">
    <link rel="icon" href="/icon.svg" type="image/svg+xml">

    <!-- Tailwind CSS & Lucide Icons -->
    <link rel="stylesheet" href="/src/index.css">
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
      body {
        -webkit-font-smoothing: antialiased;
      }
      .custom-scrollbar::-webkit-scrollbar {
        width: 8px;
      }
      .custom-scrollbar::-webkit-scrollbar-track {
        background: #1e293b;
        border-radius: 4px;
      }
      .custom-scrollbar::-webkit-scrollbar-thumb {
        background: #475569;
        border-radius: 4px;
      }
      .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background: #64748b;
      }
      .recording-pulse {
        animation: pulse-ring 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
      }
      @keyframes pulse-ring {
        0% {
          box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
        }
        70% {
          box-shadow: 0 0 0 10px rgba(239, 68, 68, 0);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
        }
      }
    </style>
    <link rel="apple-touch-icon" href="/apple-icon-180.png">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <link rel="apple-touch-startup-image" href="/apple-splash-2048-2732.jpg" media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-2732-2048.jpg" media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1668-2388.jpg" media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-2388-1668.jpg" media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1536-2048.jpg" media="(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-2048-1536.jpg" media="(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1640-2360.jpg" media="(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-2360-1640.jpg" media="(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1668-2224.jpg" media="(device-width: 834px) and (device-height: 1112px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-2224-1668.jpg" media="(device-width: 834px) and (device-height: 1112px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1620-2160.jpg" media="(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-2160-1620.jpg" media="(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1488-2266.jpg" media="(device-width: 744px) and (device-height: 1133px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-2266-1488.jpg" media="(device-width: 744px) and (device-height: 1133px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1320-2868.jpg" media="(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-2868-1320.jpg" media="(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1206-2622.jpg" media="(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-2622-1206.jpg" media="(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1260-2736.jpg" media="(device-width: 420px) and (device-height: 912px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-2736-1260.jpg" media="(device-width: 420px) and (device-height: 912px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1290-2796.jpg" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-2796-1290.jpg" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1179-2556.jpg" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-2556-1179.jpg" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1170-2532.jpg" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-2532-1170.jpg" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1284-2778.jpg" media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-2778-1284.jpg" media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1125-2436.jpg" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-2436-1125.jpg" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1242-2688.jpg" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-2688-1242.jpg" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-828-1792.jpg" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1792-828.jpg" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1242-2208.jpg" media="(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-2208-1242.jpg" media="(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-750-1334.jpg" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1334-750.jpg" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)">
    <link rel="apple-touch-startup-image" href="/apple-splash-640-1136.jpg" media="(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)">
    <link rel="apple-touch-startup-image" href="/apple-splash-1136-640.jpg" media="(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)">
  </head>
  <body class="bg-slate-900 text-slate-200 min-h-screen flex flex-col font-sans lg:h-screen lg:overflow-hidden">

    <!-- Splash Screen / Loading Overlay -->
    <div id="splashScreen" class="fixed inset-0 bg-slate-950 z-[100] flex flex-col items-center justify-center p-6 transition-opacity duration-700">
      <div class="mb-12 flex flex-col items-center animate-in fade-in zoom-in duration-1000">
        <div class="bg-blue-600 p-5 rounded-3xl mb-6 shadow-2xl shadow-blue-500/20 relative">
          <i data-lucide="mic-2" class="w-16 h-16 text-white"></i>
          <div class="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-4 border-slate-950 animate-pulse"></div>
        </div>
        <h1 class="text-3xl font-bold text-white tracking-tight mb-2">ローカルAI議事録アシスタント</h1>
        <div class="flex items-center gap-2 text-slate-500 text-sm font-medium">
          <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span id="splashSubtext">セキュアなローカル環境を初期化中...</span>
        </div>
      </div>
      <div id="splashLoadingArea" class="w-full max-w-sm space-y-4 opacity-0 transition-opacity duration-500">
        <div class="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden shadow-inner">
          <div id="splashProgressBar" class="bg-blue-500 h-full transition-all duration-300 shadow-[0_0_10px_rgba(59,130,246,0.5)]" style="width: 0%"></div>
        </div>
        <div class="flex justify-between items-center text-[10px] font-mono tracking-widest text-slate-500 uppercase">
          <div class="flex flex-col gap-1">
            <span id="splashStatusText">キャッシュを確認中...</span>
            <span id="splashTimeRemaining" class="text-blue-400/70 lowercase normal-case"></span>
          </div>
          <span id="splashPercentText">0%</span>
        </div>
        <div class="pt-4 flex flex-col items-center gap-2">
          <button id="splashChangeModelBtn" class="text-[10px] text-slate-500 hover:text-blue-400 transition border border-slate-800 px-3 py-1.5 rounded-full uppercase tracking-widest font-bold bg-slate-900/50">
            モデルを変更する (軽量版など)
          </button>
          <p class="text-[9px] text-slate-600 text-center max-w-[200px]">※100%で停止・クラッシュする場合は、軽量モデル（1B）をお試しください。</p>
        </div>
      </div>
      <div class="absolute bottom-10 text-slate-600 text-[10px] tracking-widest font-bold flex items-center gap-4">
        <span>WebGPU 加速</span>
        <span class="w-1 h-1 rounded-full bg-slate-700"></span>
        <span>プライバシー保護 100%</span>
        <span class="w-1 h-1 rounded-full bg-slate-700"></span>
        <span>オープンソース</span>
      </div>
    </div>

    <!-- Header -->
    <header class="bg-slate-900 border-b border-slate-800 px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4 shrink-0 z-20 shadow-xl">
      <div class="flex items-center gap-4 w-full md:w-auto">
        <button id="toggleSidebarBtn" class="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-md lg:hidden">
          <i data-lucide="menu" class="w-5 h-5"></i>
        </button>
        <div class="flex items-center gap-3">
          <div class="bg-blue-600 p-2 rounded-lg">
            <i data-lucide="mic-2" class="w-5 h-5 text-white"></i>
          </div>
          <h1 class="text-xl font-black text-slate-100 tracking-tighter uppercase italic">ローカルAI議事録</h1>
        </div>
        <div class="hidden xl:flex items-center gap-2">
            <span class="bg-slate-800 text-emerald-400 text-[10px] px-2 py-1 rounded border border-slate-700 font-mono flex items-center gap-1">
                <i data-lucide="zap" class="w-3 h-3"></i> WebGPU
            </span>
            <span id="currentModelDisplay" class="bg-blue-900/50 text-blue-300 text-[10px] px-3 py-1 rounded-full border border-blue-700/50 font-bold flex items-center gap-1">
                <i data-lucide="cpu" class="w-3 h-3"></i> <span id="currentModelName">読み込み中...</span>
            </span>
        </div>
      </div>

      <!-- Centered Global Controls: ALWAYS VISIBLE AND ACCESSIBLE -->
      <div class="flex items-center bg-slate-950/80 rounded-2xl p-1.5 border border-slate-800 shadow-inner w-full md:w-auto max-w-2xl">
          <button id="recBtn" class="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-black text-sm transition-all active:scale-95 shadow-lg shadow-blue-900/40 whitespace-nowrap">
            <i data-lucide="mic" class="w-4 h-4"></i> <span id="recBtnText">録音開始</span>
          </button>
          
          <div class="flex items-center gap-4 px-4 border-r border-slate-800 mx-1">
            <div id="recIndicator" class="w-2.5 h-2.5 rounded-full bg-slate-600 transition-all duration-300"></div>
            <span id="timerDisplay" class="font-mono text-xl font-light text-slate-200 tracking-wider w-24">00:00:00</span>
          </div>

          <div class="flex-1 flex items-center gap-2 px-2 min-w-[140px]">
            <select id="micSelect" class="bg-transparent text-slate-300 text-xs py-1 px-2 focus:outline-none w-full truncate"></select>
            <button id="refreshMicBtn" class="p-1.5 text-slate-500 hover:text-white transition" title="マイク更新">
                <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
            </button>
          </div>

          <div class="px-3 border-l border-slate-800">
              <label class="flex items-center gap-2 cursor-pointer group" title="リアルタイム要約">
                <input type="checkbox" id="realtimeAiToggle" class="sr-only peer" checked>
                <div class="relative w-8 h-4 bg-slate-700 rounded-full transition-colors peer-checked:bg-emerald-500">
                    <div class="absolute left-0.5 top-0.5 bg-white w-3 h-3 rounded-full transition-transform transform peer-checked:translate-x-4"></div>
                </div>
                <i data-lucide="zap" class="w-3.5 h-3.5 text-slate-500 peer-checked:text-emerald-400"></i>
              </label>
          </div>
      </div>

      <div class="flex items-center gap-2">
        <button id="settingsBtn" class="text-slate-400 hover:text-white transition bg-slate-800 hover:bg-slate-700 p-2.5 rounded-xl border border-slate-700 text-sm">
          <i data-lucide="settings" class="w-5 h-5"></i>
        </button>
      </div>
    </header>

    <!-- Main Content Container -->
    <div class="flex-1 flex flex-col lg:flex-row lg:overflow-hidden relative">

      <!-- Mobile Top Navigation Tabs -->
      <nav class="lg:hidden flex border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40">
          <button id="mobileTabTranscription" class="flex-1 py-4 text-[10px] font-black uppercase tracking-[0.2em] border-b-2 border-blue-400 text-blue-400 transition-all">文字起こし</button>
          <button id="mobileTabAi" class="flex-1 py-4 text-[10px] font-black uppercase tracking-[0.2em] border-b-2 border-transparent text-slate-500 transition-all">リアルタイム要約</button>
      </nav>

      <!-- Sidebar: History -->
      <aside id="sidebar" class="fixed inset-y-0 left-0 w-72 bg-slate-950 border-r border-slate-800 z-30 transform -translate-x-full lg:translate-x-0 lg:static transition-transform duration-300 flex flex-col h-full">
        <div class="p-4 border-b border-slate-800 flex justify-between items-center">
          <span class="text-xs font-bold text-slate-500 tracking-widest uppercase">保存されたセッション</span>
          <div class="flex items-center gap-1">
            <button id="newSessionBtn" class="p-1.5 text-blue-400 hover:bg-blue-900/30 rounded-md transition" title="新規セッション">
              <i data-lucide="plus-circle" class="w-5 h-5"></i>
            </button>
            <button id="closeSidebarBtn" class="p-1.5 text-slate-500 hover:text-white lg:hidden">
              <i data-lucide="chevron-left" class="w-5 h-5"></i>
            </button>
          </div>
        </div>
        <div id="historyList" class="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">

          <!-- History items will be injected here -->
          <div class="text-center py-10 text-slate-600 text-xs italic">保存されたデータはありません</div>
        </div>
        <div class="p-4 border-t border-slate-800 bg-slate-900/50">
          <div class="flex items-center justify-between text-[10px] text-slate-500 mb-2">
            <span class="text-xs font-bold text-slate-500 tracking-widest uppercase">ストレージ使用量</span>
            <span id="storageUsageText">0 MB</span>
          </div>
          <div class="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
            <div id="storageUsageBar" class="bg-blue-600 h-full" style="width: 0%"></div>
          </div>
        </div>
      </aside>

      <!-- Main Content Split Layout -->
      <main class="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden bg-slate-950">
        
        <!-- Left Section: Transcription -->
        <section id="leftSection" class="flex-1 flex flex-col border-r border-slate-800 bg-slate-900/40 relative">
            <div class="px-5 py-3 border-b border-slate-800 flex justify-between items-center bg-slate-900/80 backdrop-blur-md">
                <span class="text-xs font-bold text-slate-400 tracking-wider flex items-center gap-2 uppercase">
                    <i data-lucide="align-left" class="w-4 h-4"></i> 文字起こし
                </span>
                <div class="flex gap-1">
                    <button id="downloadTransBtn" class="text-slate-400 hover:text-white p-2 rounded hover:bg-slate-800 transition disabled:opacity-30" title="テキストを保存" disabled>
                        <i data-lucide="save" class="w-4 h-4"></i>
                    </button>
                    <button id="downloadAudioBtn" class="text-slate-400 hover:text-white p-2 rounded hover:bg-slate-800 transition disabled:opacity-30" title="音声保存" disabled>
                        <i data-lucide="download" class="w-4 h-4"></i>
                    </button>
                    <button id="clearDataBtn" class="text-slate-400 hover:text-red-400 p-2 rounded hover:bg-red-900/20 transition" title="消去">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>

            <div id="viewTranscription" class="flex-1 overflow-y-auto custom-scrollbar p-6 pb-24 text-slate-200 leading-relaxed">
                <!-- Error Area Immersive -->
                <div id="sysErrorArea" class="hidden mb-4 bg-red-900/40 border border-red-800/50 text-red-100 text-[10px] p-3 rounded-lg flex gap-2 items-center">
                    <i data-lucide="alert-triangle" class="w-3.5 h-3.5 shrink-0"></i><span id="sysErrorText"></span>
                </div>

                <div id="transcriptionPlaceholder" class="text-slate-600 flex flex-col items-center justify-center h-full opacity-40">
                  <i data-lucide="activity" class="w-12 h-12 mb-4"></i>
                  <p class="text-sm font-bold uppercase tracking-widest mb-1">録音準備完了</p>
                  <p class="text-[10px]">上のボタンから録音を開始してください</p>
                </div>
                <div id="transcriptionDisplay" class="whitespace-pre-wrap break-words text-lg"></div>
                <div id="interimDisplay" class="text-slate-500 italic mt-2 text-lg"></div>
            </div>

            <!-- Manual Memo Input Floating -->
            <div class="absolute bottom-6 left-6 right-6 z-10 transition-transform focus-within:scale-[1.02]">
                <div class="bg-slate-900/90 backdrop-blur-xl border border-slate-700 p-2 pl-4 rounded-2xl flex items-center gap-2 shadow-2xl shadow-black/50">
                    <i data-lucide="sticky-note" class="w-4 h-4 text-slate-500"></i>
                    <textarea id="manualMemoInput" placeholder="重要なメモを追加..." class="flex-1 bg-transparent border-none py-2 text-sm text-slate-200 focus:outline-none resize-none h-10 custom-scrollbar"></textarea>
                    <button id="addMemoBtn" class="bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-xl transition shadow-lg shadow-blue-900/40">
                        <i data-lucide="plus" class="w-5 h-5"></i>
                    </button>
                </div>
            </div>
        </section>

        <!-- Right Section: Real-time AI -->
        <section id="rightSection" class="flex-1 flex flex-col bg-slate-950 relative overflow-hidden">
             <div class="px-5 py-3 border-b border-slate-800 flex justify-between items-center bg-slate-900/40 backdrop-blur-md">
                <span class="text-xs font-bold text-emerald-500/80 tracking-widest flex items-center gap-2 uppercase">
                    <i data-lucide="zap" class="w-4 h-4"></i> リアルタイム要約
                </span>
                <button id="openAiPanelBtn" class="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 px-3 py-1 rounded-full border border-emerald-500/30 text-[10px] font-bold uppercase tracking-tighter transition flex items-center gap-1.5 shadow-lg shadow-emerald-950/40">
                    <i data-lucide="bot" class="w-3 h-3"></i> セッションを分析
                </button>
            </div>

            <div id="viewRealtimeAI" class="flex-1 overflow-y-auto custom-scrollbar p-8 text-emerald-50 leading-relaxed">
                <div id="realtimePlaceholder" class="text-emerald-900/40 flex flex-col items-center justify-center h-full">
                  <i data-lucide="sparkles" class="w-16 h-16 mb-4 opacity-10 animate-pulse"></i>
                  <p class="text-sm font-bold uppercase tracking-widest mb-1">AIがリアルタイムで分析中...</p>
                   <p class="text-[10px]">話すと内容が表示されます</p>
                </div>
                <div id="realtimeAiDisplay" class="whitespace-pre-wrap break-words space-y-4"></div>
            </div>

            <!-- Global Action Hint -->
             <div class="p-4 text-center border-t border-slate-800 bg-slate-900/50">
                 <p class="text-[9px] text-slate-500 uppercase tracking-[0.2em] font-bold">深層学習実行中 • 4096トークン・コンテキスト</p>
             </div>
        </section>
      </main>
    </div>

    <!-- Settings Modal -->
    <div id="settingsModal" class="hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div class="bg-slate-800 rounded-xl border border-slate-600 shadow-2xl w-full max-w-md overflow-hidden transform transition-all">
        <div class="px-6 py-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
          <h2 class="font-bold text-lg text-slate-100 flex items-center gap-2">
            <i data-lucide="settings" class="w-5 h-5 text-blue-400"></i> WebLLM 設定
          </h2>
          <button id="closeSettingsBtn" class="text-slate-400 hover:text-white transition"><i data-lucide="x" class="w-5 h-5"></i></button>
        </div>
        <div class="p-6 space-y-5 max-h-[70vh] overflow-y-auto custom-scrollbar">
          <div>
            <label class="block text-sm font-bold text-slate-300 mb-1">AIモデル選択 (速度 vs 精度)</label>
            <select id="modelNameInput" class="w-full bg-slate-900 border border-slate-600 rounded-md px-4 py-2.5 text-sm text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition font-mono">
              <optgroup label="Gemma シリーズ">
                <option value="gemma-4-e4b-it-q4f16_1-MLC" selected>🔥 Gemma 4 4B (試験実装・最強クラス)</option>
                <option value="gemma-4-E2B-it-q4f16_1-MLC">✨ Gemma 4 2B (最新・軽量)</option>
                <option value="gemma-3-9b-it-q4f16_1-MLC">🧠 Gemma 3 9B (高精度モデル・強制読込)</option>
              </optgroup>
              <optgroup label="Llama シリーズ">
                <option value="Llama-3.2-3B-Instruct-q4f16_1-MLC">🎙️ Llama 3.2 3B (標準・高精度)</option>
                <option value="Llama-3.2-1B-Instruct-q4f16_1-MLC">⚡ Llama 3.2 1B (高速・軽量)</option>
              </optgroup>
            </select>
            <p class="text-xs text-slate-500 mt-1.5">※初回実行時にブラウザのキャッシュにモデルがダウンロードされます。</p>
          </div>
          <div id="modelChangeWarning" class="hidden bg-amber-900/20 border border-amber-700/30 rounded-md p-4 text-xs text-amber-200 leading-relaxed">
            <strong class="flex items-center gap-1 mb-1 text-amber-400 font-bold"><i data-lucide="alert-circle" class="w-4 h-4"></i> モデル変更の注意</strong>
            モデルを変更して保存すると、ページが再読み込みされ、新しいモデルの再ダウンロード（約1GB〜6GB）が開始されます。
          </div>
          <div class="bg-emerald-900/20 border border-emerald-700/50 rounded-md p-4 text-xs text-emerald-200 leading-relaxed">
            <strong class="flex items-center gap-1 mb-1 text-emerald-400"><i data-lucide="info" class="w-4 h-4"></i> WebGPUについて</strong>
            このアプリは外部サーバーやOllamaを一切使用せず、お使いのデバイスのGPU（WebGPU）を使用してブラウザ内で直接AIを動かします。データが外部に送信されることはなく、プライバシーは完全に保護されます。
          </div>
        </div>
        <div class="px-6 py-4 border-t border-slate-700 bg-slate-800/50 flex justify-end">
          <button id="saveSettingsBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md text-sm font-bold transition shadow-sm">保存して閉じる</button>
        </div>
      </div>
    </div>

    <!-- Setup / Version Update Modal -->
    <div id="setupModal" class="hidden fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[300] flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-300">
        <div class="p-8 text-center">
          <div class="bg-blue-600 w-20 h-20 rounded-3xl mx-auto mb-6 flex items-center justify-center shadow-2xl shadow-blue-500/20">
            <i data-lucide="sparkles" class="w-10 h-10 text-white"></i>
          </div>
          <h2 class="text-3xl font-bold text-white mb-2">バージョンアップのお知らせ</h2>
          <p id="setupModalMessage" class="text-slate-400 text-sm mb-8 leading-relaxed">
            新バージョンの準備ができました。これに伴い、最新のAIモデルを選択してください。<br>
            ※モデルの切り替えには大容量の再ダウンロードが必要です。
          </p>
          
          <div class="space-y-3 mb-8 text-left">
            <span class="text-[10px] uppercase tracking-widest font-bold text-slate-500 mb-2 block">推奨モデルを選択してください</span>
            
            <label class="flex items-center gap-4 p-4 bg-slate-800/50 rounded-xl border-2 border-slate-700 cursor-pointer hover:border-blue-500 transition group has-[:checked]:border-blue-600 has-[:checked]:bg-blue-900/10">
              <input type="radio" name="setupModel" value="gemma-4-e4b-it-q4f16_1-MLC" checked class="w-5 h-5 text-blue-600 focus:ring-blue-500 bg-slate-800 border-slate-700">
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <span class="font-bold text-slate-100 italic">GEMMA 4 4B (最強推奨)</span>
                  <span class="bg-blue-600 text-[9px] px-1.5 py-0.5 rounded-sm font-bold uppercase text-white">PREMIER</span>
                </div>
                <p class="text-[10px] text-slate-400">最高の補正精度と推論能力を持つ最新モデル</p>
              </div>
            </label>

            <label class="flex items-center gap-4 p-4 bg-slate-800/50 rounded-xl border-2 border-slate-700 cursor-pointer hover:border-emerald-500 transition group has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-900/10">
              <input type="radio" name="setupModel" value="gemma-3-9b-it-q4f16_1-MLC" class="w-5 h-5 text-emerald-600 focus:ring-emerald-500 bg-slate-800 border-slate-700">
              <div class="flex-1">
                <span class="font-bold text-slate-100">GEMMA 3 9B (高精度)</span>
                <p class="text-[10px] text-slate-400">安定した処理能力。大容量ダウンロードが必要です。</p>
              </div>
            </label>

            <label class="flex items-center gap-4 p-4 bg-slate-800/50 rounded-xl border-2 border-slate-700 cursor-pointer hover:border-slate-500 transition group has-[:checked]:border-slate-400 has-[:checked]:bg-slate-700/20">
              <input type="radio" name="setupModel" value="Llama-3.2-3B-Instruct-q4f16_1-MLC" class="w-5 h-5 text-slate-300 focus:ring-slate-500 bg-slate-800 border-slate-700">
              <div class="flex-1">
                <span class="font-bold text-slate-100">Llama 3.2 3B (標準)</span>
                <p class="text-[10px] text-slate-400">軽量さと精度のバランスが取れた標準モデル</p>
              </div>
            </label>
          </div>

          <button id="finishSetupBtn" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-bold text-lg transition-all shadow-xl shadow-blue-500/20 active:scale-[0.98] flex items-center justify-center gap-2">
            セットアップを開始する <i data-lucide="arrow-right" class="w-5 h-5"></i>
          </button>
        </div>
      </div>
    </div>

    <!-- PWA Modals -->

    <!-- LINE Browser Warning Modal -->
    <div id="lineWarningModal" class="fixed inset-0 bg-slate-950/90 z-[200] hidden flex items-center justify-center p-4 backdrop-blur-sm">
      <div class="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-sm w-full shadow-2xl">
        <h3 class="text-xl font-bold text-red-400 mb-3 flex items-center gap-2"><i data-lucide="alert-triangle"></i> ブラウザ推奨</h3>
        <p class="text-slate-300 text-sm mb-4 leading-relaxed">LINE内ブラウザではマイクやAI機能が正常に動作しません。<br><br>右上のメニュー（︙）から「他のブラウザで開く」を選択し、<strong class="text-emerald-400">Chrome</strong> または <strong class="text-blue-400">Edge</strong> をご利用ください。</p>
      </div>
    </div>

    <!-- PWA Install Prompt Modal (PC) -->
    <div id="pwaInstallModal" class="fixed inset-0 bg-slate-950/80 z-[200] hidden flex items-center justify-center p-4 backdrop-blur-sm">
      <div class="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-sm w-full shadow-2xl">
        <h3 class="text-xl font-bold text-blue-400 mb-3 flex items-center gap-2"><i data-lucide="download"></i> アプリとしてインストール</h3>
        <p class="text-slate-300 text-sm mb-4 leading-relaxed">PCブラウザのタブとしてではなく、独立したアプリとしてインストールすることをお勧めします。より快適に動作します。</p>
        <div class="flex justify-end gap-3">
          <button id="pwaInstallCancelBtn" class="px-4 py-2 text-sm text-slate-400 hover:text-white transition">後で</button>
          <button id="pwaInstallBtn" class="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md font-bold transition">インストール</button>
        </div>
      </div>
    </div>

    <!-- PWA Update Modal -->
    <div id="pwaUpdateModal" class="fixed bottom-4 right-4 bg-slate-800 border border-emerald-600/50 rounded-xl p-5 shadow-2xl z-[200] hidden max-w-sm animate-in slide-in-from-bottom-5">
      <h3 class="text-lg font-bold text-emerald-400 mb-2 flex items-center gap-2"><i data-lucide="refresh-cw"></i> アップデートがあります</h3>
      <p class="text-slate-300 text-sm mb-4">新しいバージョンが利用可能です。更新して最新機能を利用してください。</p>
      <div class="flex justify-end gap-3">
        <button id="pwaUpdateBtn" class="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-bold transition">今すぐ更新</button>
      </div>
    </div>

    <!-- AI Analysis Modal (Separate Analysis Screen) -->
    <div id="aiAnalysisModal" class="fixed inset-0 z-[500] bg-slate-950 flex flex-col hidden overflow-hidden">
        <header class="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/80 backdrop-blur-xl shrink-0">
           <div class="flex items-center gap-4">
               <button id="closeAiModalBtn" class="text-slate-400 hover:text-white p-2 rounded-full hover:bg-slate-800 transition">
                   <i data-lucide="arrow-left" class="w-6 h-6"></i>
               </button>
               <div>
                   <h2 class="text-lg font-bold text-slate-100 italic">詳細セッション分析</h2>
                   <p class="text-[10px] text-slate-500 uppercase tracking-widest">タスクを選択し、AI動作をカスタマイズ</p>
               </div>
           </div>
           <button id="generateBtn" class="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-3 rounded-xl font-black text-sm transition-all shadow-xl shadow-emerald-900/40 flex items-center gap-2">
               <i data-lucide="play" class="w-4 h-4 fill-current"></i> AI分析を実行
           </button>
        </header>

        <div class="flex-1 overflow-hidden bg-slate-950 flex flex-col lg:flex-row">
            <!-- Selection Sidebar -->
            <aside class="w-full lg:w-80 border-r border-slate-800 p-6 flex flex-col gap-8 bg-slate-900/30 overflow-y-auto custom-scrollbar">
                <div class="space-y-4">
                    <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <i data-lucide="list-checks" class="w-4 h-4"></i> 分析タスク
                    </h3>
                    <div id="aiTasksList" class="space-y-2">
                       <label class="flex items-center gap-3 p-3 rounded-xl border border-slate-700 bg-slate-950/50 cursor-pointer hover:border-emerald-500 transition group has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-900/10">
                          <input type="checkbox" name="aiTask" value="correction" class="hidden" checked>
                          <div class="w-4 h-4 rounded border-2 border-slate-600 flex items-center justify-center group-hover:border-emerald-500 transition">
                              <i data-lucide="check" class="w-3 h-3 text-white hidden"></i>
                          </div>
                          <span class="text-xs font-bold text-slate-300 group-hover:text-emerald-400 transition uppercase tracking-tighter">文字起こしの補正</span>
                       </label>
                       <label class="flex items-center gap-3 p-3 rounded-xl border border-slate-700 bg-slate-950/50 cursor-pointer hover:border-emerald-500 transition group has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-900/10">
                          <input type="checkbox" name="aiTask" value="minutes" class="hidden" checked>
                          <div class="w-4 h-4 rounded border-2 border-slate-600 flex items-center justify-center group-hover:border-emerald-500 transition">
                              <i data-lucide="check" class="w-3 h-3 text-white hidden"></i>
                          </div>
                          <span class="text-xs font-bold text-slate-300 group-hover:text-emerald-400 transition uppercase tracking-tighter">要点・議事録作成</span>
                       </label>
                       <label class="flex items-center gap-3 p-3 rounded-xl border border-slate-700 bg-slate-950/50 cursor-pointer hover:border-emerald-500 transition group has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-900/10">
                          <input type="checkbox" name="aiTask" value="todo" class="hidden">
                          <div class="w-4 h-4 rounded border-2 border-slate-600 flex items-center justify-center group-hover:border-emerald-500 transition">
                              <i data-lucide="check" class="w-3 h-3 text-white hidden"></i>
                          </div>
                          <span class="text-xs font-bold text-slate-300 group-hover:text-emerald-400 transition uppercase tracking-tighter">TODO抽出</span>
                       </label>
                    </div>
                </div>

                <div class="space-y-6">
                    <div class="space-y-3">
                        <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                            <i data-lucide="maximize" class="w-4 h-4"></i> 出力の長さ
                        </h3>
                        <div class="flex flex-col gap-1">
                            <select id="aiLengthSelect" class="w-full bg-slate-950 border border-slate-700 p-3 rounded-xl text-slate-300 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none appearance-none cursor-pointer font-bold">
                                <option value="short">短め（箇条書き）</option>
                                <option value="medium" selected>標準</option>
                                <option value="long">長め（詳細）</option>
                            </select>
                        </div>
                    </div>

                    <div class="space-y-3">
                        <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                            <i data-lucide="message-square" class="w-4 h-4"></i> トーンとスタイル
                        </h3>
                        <div class="flex flex-col gap-1">
                            <select id="aiToneSelect" class="w-full bg-slate-950 border border-slate-700 p-3 rounded-xl text-slate-300 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none appearance-none cursor-pointer font-bold">
                                <option value="neutral" selected>標準</option>
                                <option value="formal">フォーマル / ビジネス</option>
                                <option value="informal">フレンドリー / カジュアル</option>
                            </select>
                        </div>
                    </div>
                </div>
                <!-- Mini Model Info -->
                <div class="mt-auto p-4 bg-emerald-500/5 rounded-2xl border border-emerald-500/10">
                    <p class="text-[10px] text-emerald-500/60 uppercase font-black tracking-widest mb-1 italic">エンジン最適化</p>
                    <p class="text-[9px] text-slate-500 leading-tight">要約生成は、一貫性向上のために<span class="text-emerald-400">4096トークン</span>のコンテキストウィンドウで最適化されています。</p>
                </div>
            </aside>

            <!-- Results Display Area -->
            <section class="flex-1 flex flex-col p-8 relative min-h-0 min-w-0 bg-slate-900/10 h-full">
                <div id="aiAnalysisResultsArea" class="flex-1 overflow-y-auto custom-scrollbar max-w-4xl mx-auto w-full pb-32 h-full">
                    <div id="summaryPlaceholder" class="flex flex-col items-center justify-center h-full text-slate-800 opacity-30 space-y-4">
                        <i data-lucide="cpu" class="w-24 h-24 stroke-[1px]"></i>
                        <div class="text-center">
                            <p class="text-xl font-bold uppercase tracking-widest">AI分析デスク</p>
                            <p class="text-[10px] tracking-[0.4em]">コマンド待機中</p>
                        </div>
                    </div>

                    <!-- Loading Indicator Internal (Hidden by default) -->
                    <div id="loadingIndicator" class="hidden flex-col items-center justify-center h-full absolute inset-0 z-50 bg-slate-950/40 backdrop-blur-sm">
                      <div class="relative w-24 h-24 mb-6">
                          <div class="absolute inset-0 rounded-full border-2 border-slate-800"></div>
                          <div class="absolute inset-0 rounded-full border-t-2 border-emerald-500 animate-spin"></div>
                          <div class="absolute inset-0 flex items-center justify-center">
                              <i data-lucide="brain-circuit" class="w-8 h-8 text-emerald-500 animate-pulse"></i>
                          </div>
                      </div>
                      <h3 class="text-emerald-100 font-bold uppercase tracking-[0.2em] mb-1">分析実行中...</h3>
                      <div id="downloadProgressContainer" class="w-48 mt-4 h-0.5 bg-slate-800 rounded-full overflow-hidden hidden">
                        <div id="downloadProgressBar" class="h-full bg-emerald-500 transition-all duration-300" style="width: 0%"></div>
                      </div>
                    </div>

                    <div id="summaryDisplay" class="hidden prose prose-invert max-w-none text-slate-100 leading-relaxed text-lg"></div>
                </div>

                <!-- Analysis Bottom Actions -->
                <div id="aiActionFooter" class="hidden absolute bottom-10 left-1/2 -translate-x-1/2 z-20 flex justify-center gap-4 bg-slate-900/80 p-6 border border-white/5 rounded-3xl backdrop-blur-xl shadow-2xl">
                    <button id="copyAiBtn" class="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 px-6 py-3 rounded-2xl border border-slate-700 transition active:scale-95">
                       <i data-lucide="copy" class="w-4 h-4"></i> 結果をコピー
                    </button>
                    <button id="downloadTextBtnModal" class="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 px-6 py-3 rounded-2xl border border-slate-700 transition active:scale-95">
                       <i data-lucide="download" class="w-4 h-4"></i> ファイルを保存
                    </button>
                </div>
            </section>
        </div>
    </div>

    <!-- Main Logic as ES Module -->
    <script type="module" src="/src/app.js"></script>
  </body>
</html>