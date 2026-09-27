// 端末の確かめ（check.html）。ブラウザの情報と、議事録が使う機能の「有る・無し」を画面に出すだけ。
// 機能そのものは呼ばない（有るかを見るだけ）。何も送信・保存しない。古い WebView でも動く書き方にしている。
(function () {
  var rows = [];
  function add(k, v) { rows.push([k, v]); }
  function has(f) {
    try { return f() ? '有り' : '無し'; } catch (e) { return '分からない'; }
  }
  var ua = '';
  try { ua = String(navigator.userAgent || ''); } catch (e) { /* 空のまま */ }
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  add('ブラウザの情報', ua || '（取れない）');
  add('アプリの中のブラウザ', window.__QB_INAPP ? 'はい（' + window.__QB_INAPP + '）' : 'いいえ');
  add('ホーム画面から開いた', has(function () {
    return navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }));
  add('音声認識', SR ? (window.SpeechRecognition ? 'SpeechRecognition' : 'webkitSpeechRecognition') : '無し');
  add('端末内の音声認識の確認', has(function () { return SR && typeof SR.available === 'function'; }));
  add('マイク', has(function () { return navigator.mediaDevices && navigator.mediaDevices.getUserMedia; }));
  add('録音', has(function () { return typeof MediaRecorder !== 'undefined'; }));
  add('音の処理', has(function () { return window.AudioContext || window.webkitAudioContext; }));
  add('保存の場所', has(function () { return window.indexedDB; }));
  add('Service Worker', has(function () { return 'serviceWorker' in navigator; }));
  add('Web Locks', has(function () { return navigator.locks; }));
  add('画面の大きさ', window.innerWidth + ' × ' + window.innerHeight);
  var tb = document.getElementById('rows');
  if (!tb) return;
  for (var i = 0; i < rows.length; i++) {
    var tr = document.createElement('tr');
    var th = document.createElement('th');
    var td = document.createElement('td');
    th.textContent = rows[i][0];
    td.textContent = rows[i][1];
    tr.appendChild(th);
    tr.appendChild(td);
    tb.appendChild(tr);
  }
})();
