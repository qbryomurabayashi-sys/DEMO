// アプリの中のブラウザ（LINE・LINE WORKS など）で開かれたとき、本体（app.js）が読み込めなくても「Chrome で開いて」の帯だけは出す。
// 判定は src/lib/util.js の isInAppBrowser と同じ決まり（本体が動けば、本体も同じ帯を出す）。古い WebView でも動く書き方にしている。
(function () {
  try {
    var s = navigator.userAgent || '';
    var standalone = (window.navigator && window.navigator.standalone === true) ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    var inapp = /\bLine\//.test(s) || /LINEWORKS|worksmobile|NAVER\(inapp/i.test(s) || /FBAN|FBAV|FB_IAB|Instagram|KAKAOTALK/i.test(s) ||
      (/Android/.test(s) && /; wv\)/.test(s)) ||
      (/iPhone|iPad|iPod/.test(s) && !standalone && !/Safari\//.test(s) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(s));
    if (!inapp) return;
    var b = document.getElementById('lineBanner');
    if (b) b.hidden = false;
    var r = document.getElementById('recBtn');
    if (r) r.disabled = true;
    var a = document.getElementById('lineOpenChromeBtn');
    if (a) {
      var here = location.href;
      var rest = location.host + location.pathname + location.search + location.hash;
      var url = '';
      if (/Android/.test(s)) url = 'intent://' + rest + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(here) + ';end';
      else if (/iPhone|iPad|iPod/.test(s)) url = 'googlechromes://' + rest;
      if (url) { a.href = url; a.hidden = false; }
    }
  } catch (e) { /* 判定に失敗しても、ふつうに開く */ }
})();
