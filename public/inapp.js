// アプリの中のブラウザ（LINE・LINE WORKS など）で開かれたときの案内。
// <head> の中で、ほかより先に（defer なしで）読む。当たったら <html> に is-inapp を付ける。
// - 画面：CSS（src/index.css の is-inapp）が、案内の画面 #inappScreen だけを出す
// - 本体：app.js は window.__QB_INAPP を見て、何も始めない。録音・保存・文字起こしの確認・マイクの一覧・Service Worker など、
//   アプリの中のブラウザで落ちる元になりうるものを一切呼ばない
// 判定は src/lib/util.js の isInAppBrowser と同じ決まり（test/inapp.test.mjs で突き合わせる）。古い WebView でも動く書き方にしている。
(function () {
  var s = '';
  try { s = String(navigator.userAgent || ''); } catch (e) { return; }
  var standalone = false;
  try {
    standalone = (window.navigator && window.navigator.standalone === true) ||
      !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  } catch (e) { /* 分からなければ、ホーム画面から開いたのではない扱い */ }
  var line = /\bLine\//.test(s);
  var inapp = line || /LINEWORKS|worksmobile|NAVER\(inapp/i.test(s) || /FBAN|FBAV|FB_IAB|Instagram|KAKAOTALK/i.test(s) ||
    (/Android/.test(s) && /; wv\)/.test(s)) ||
    (/iPhone|iPad|iPod/.test(s) && !standalone && !/Safari\//.test(s) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(s));
  if (!inapp) return;
  window.__QB_INAPP = line ? 'line' : 'other';
  try { document.documentElement.className += ' is-inapp'; } catch (e) { /* 付けられなくても先へ */ }

  function ready() {
    try {
      var screen = document.getElementById('inappScreen');
      if (!screen) return;
      screen.hidden = false;
      var url = location.protocol + '//' + location.host + '/';
      var field = document.getElementById('inappUrl');
      if (field) field.value = url;
      var msg = document.getElementById('inappCopyMsg');
      var say = function (t) { if (msg) msg.textContent = t; };
      // LINE だけ：LINE の決まり（URL に openExternalBrowser=1）で、外のブラウザが開く。LINE WORKS には、この決まりが無い
      var open = document.getElementById('inappOpenBtn');
      if (open && line) {
        open.setAttribute('href', url + '?openExternalBrowser=1');
        open.hidden = false;
      }
      var copy = document.getElementById('inappCopyBtn');
      if (copy) {
        copy.addEventListener('click', function () {
          var ok = 'コピーしました。Chrome を開いて、アドレス欄に貼り付けてください';
          var ng = '下の URL を長押しして、コピーしてください';
          var legacy = function () {
            var done = false;
            try {
              if (field) {
                field.focus();
                field.select();
                field.setSelectionRange(0, field.value.length);
              }
              done = !!(document.execCommand && document.execCommand('copy'));
            } catch (e) { done = false; }
            say(done ? ok : ng);
          };
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(url).then(function () { say(ok); }, legacy);
              return;
            }
          } catch (e) { /* 下の方法でコピーする */ }
          legacy();
        });
      }
      // ?diag=1 を付けて開いたときだけ、ブラウザの情報（UA）を出す（問い合わせのときに、写真で送ってもらう）
      if (/[?&]diag=1(&|$)/.test(location.search)) {
        var d = document.getElementById('inappDiag');
        if (d) {
          d.textContent = s;
          d.hidden = false;
        }
      }
    } catch (e) { /* 案内が出せなくても、ほかは何もしない */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
