// QB議事録アシスタント v4 — 画面の組み立て（録音・文字起こし・メモ・保存・書き出し・履歴）
// 部品：ui.js（画面の小道具）、db.js（保存）、capture.js（音の取り込み）、sr.js（端末内の文字起こし）、wave.js（波形）、lib/*（純関数）
// 守ること：
// - 録音中に再読み込み・画面遷移をしない。native の alert / confirm / prompt は使わない（beforeunload の確認だけ例外）。
// - 保存より先に、付随する処理を await しない。保存に失敗しても録音は止めない。
// - 文字起こしは端末内だけ（認識を作るのは sr.js の1か所で、使えない条件なら作らない）。音声を外に送らない。
// - 自動保存はタイマーでなく録音のデータ（ondataavailable、1秒に1回）の回数で回す（画面が隠れても間隔が崩れないように）。

import {
    $, on, setShown, setDisabled, isImeEnter, ls, renderIcons, showToast, showConfirm, showPrompt, downloadBlob, saveFile, isDialogOpen,
} from './ui.js';
import * as db from './db.js';
import {
    canCapturePcAudio, requestPcAudio, hasAudio, stopStream, requestMic, createAudioContext, buildGraph, startMeters, stopCapture,
} from './capture.js';
import { checkAvailability, installLanguagePack, startTranscriber } from './sr.js';
import { createWave } from './wave.js';
import { tidyTranscript } from './lib/filler.js';
import { formatMemoLine, secToStamp, lastStampSec } from './lib/minutes.js';
import { provisionalTitle, isLineInApp, isInAppBrowser, isIOS, isMobileOrTablet, shouldShowUpdateToast, pickMimeType } from './lib/util.js';
import { detectBrowser, srBannerFor, SR_ACTION_LABELS } from './lib/banner.js';
import {
    formatClock, formatSessionDate, buildTranscriptTxt, makeTextBlob, transcriptTxtFilename, audioFilename,
} from './lib/export.js';

// ---- 1. 定数と環境 ----
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '4.0.0';
const UA = navigator.userAgent || '';
const TOUCH = navigator.maxTouchPoints || 0;
const STANDALONE = !!((window.navigator && window.navigator.standalone === true)
    || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
// アプリの中のブラウザ（LINE・LINE WORKS など）：本体は何も始めず、「Chrome で開いて」の画面（public/inapp.js）だけにする。
// 判定は inapp.js が先に済ませて window.__QB_INAPP に置く。inapp.js が読めなかったときのために、同じ判定をここでもする
const IS_INAPP = !!window.__QB_INAPP || isLineInApp(UA) || isInAppBrowser(UA, STANDALONE);
const IS_MOBILE = isMobileOrTablet(UA, TOUCH);
const IS_IOS = isIOS(UA, TOUCH);
const BROWSER = detectBrowser(UA);
const CAN_PC = canCapturePcAudio();
// 診断の表示：アドレスの最後に ?diag=1 を付けて開いたときだけ（普段は出さない）
const DIAG = /[?&]diag=1(&|$)/.test(location.search);
let diagLines = [];
function diag(msg) {
    if (!DIAG) return;
    const d = new Date();
    const hh = (n) => String(n).padStart(2, '0');
    diagLines.push(hh(d.getHours()) + ':' + hh(d.getMinutes()) + ':' + hh(d.getSeconds()) + ' ' + msg);
    if (diagLines.length > 50) diagLines = diagLines.slice(0, 3).concat(diagLines.slice(-47)); // 先頭の3行（版・マイク・渡す音）は残す
    const box = document.getElementById('diagBox');
    if (box) { box.hidden = false; box.textContent = diagLines.join('\n'); }
}

const TEXT_SAVE_EVERY = 10;      // ondataavailable 10回（約10秒）ごとに文字を保存（変わったときだけ）
const AUDIO_SAVE_EVERY = 30;     // 30回（約30秒）ごとに音声の断片を保存
const PC_SILENT_MS = 10000;      // PCの音がこれだけ入らなければ知らせる
const PC_SILENT_LEVEL = 0.02;    // メーターの値がこれ未満なら無音あつかい
const LOCK_PREFIX = 'qb-giji-rec-';      // 録音中の会議を、ほかの窓の後始末から守る鍵（Web Locks）
const FRESH_WITH_LOCK_MS = 15000;        // 鍵を取るまでのすき間（作った直後の記録は触らない）
const FRESH_WITHOUT_LOCK_MS = 90000;     // Web Locks が無い端末：これより新しく書かれた 'recording' は録音中とみなす
const RECOVER_AGAIN_MS = 30000;          // 起動時に見送った記録を、もう一度確かめるまで
const WAVE_COLOR_MIC = '#00327D';
const WAVE_COLOR_PC = '#0082CD';
const CANCEL = { cancelled: true };      // 利用者がやめたとき（エラーのトーストを出さない）

const NOTICE_TITLE = 'はじめに';
const NOTICE_MESSAGE = '録音と文字起こしはこの端末の中だけで行い、外には送りません\n録音は相手の了承を得てから';
const PC_CONFIRM_TITLE = 'PCの音も録音します';
const PC_CONFIRM_MESSAGE = '相手全員に録音を伝えましたか\nPCの通知音も録音されます。通知を切り、イヤホン推奨\n画面の映像は保存も送信もしません（PCの音を録るための許可です）';
const SOURCE_HINT = '共有の画面で『画面全体』を選び『システム オーディオも共有する』をオン（映像は使いません）。イヤホン推奨';
const GAP_LINE = '※この時刻から録れていない可能性（マイクが止まりました）';
const GAP_BACK_LINE = '※この時刻から録音が戻りました';
// 文字起こしが始まらないまま続くときの案内（原因は2通り。どちらも Chrome の側）
const RESTART_HELP = '文字起こしが始まりません。① Chrome をいったん全部閉じて開き直す ② それでも出ないときは、Chrome の設定の「ユーザー補助」で「自動字幕起こし」をオン（言語は日本語。「リアルタイム翻訳」はオフのまま）';

// ---- 2. 状態 ----
// phase：'idle'（待機）/ 'starting'（開始処理中）/ 'recording'（録音中）/ 'stopping'（停止処理中）
const state = {
    phase: 'idle',
    dbMode: 'ok',              // 'ok' / 'none'（この端末の設定で保存できない）
    srAvail: 'checking',       // 'checking' / 'available' / 'downloadable' / 'downloading' / 'unavailable' / 'no-api'
    srInstall: null,           // null / 'installing' / 'failed'
    srStoppedNotice: false,    // 録音中に文字起こしが止まった
    srRestartNotice: false,    // 準備した直後で、Chrome を開き直すまで文字起こしが動かない（録音中に見分けた）
    srFreshInstall: false,     // この画面で言語データを取得した（初回の取得のあとは、Chrome を開き直すまで動かない）
    srBannerKey: '',
    srBannerClosed: false,
    source: 'mic',             // 'mic' / 'mix'
    memoType: 'memo',
    fillerOn: true,
};
let current = null;            // 開いている会議（メモリ上の1件）。書き出しはタップの中でここから同期で作る
let rec = null;                // 録音中の道具一式（録音していないときは null）
let exportsReady = { txt: null, audio: null };
let wakeLock = null;
let guardOn = false;

function isBusy() {
    return state.phase !== 'idle';
}

function elapsedSec(r) {
    return r && r.startedAt ? Math.max(0, (Date.now() - r.startedAt) / 1000) : 0;
}

// ---- 3. 本文の表示 ----
const LINE_RE = /^\[(\d{2}:\d{2}(?::\d{2})?)\]\s*(.*)$/;
const MEMO_RE = /^【(重要メモ|決定|ToDo)】\s*(.*)$/;

// 本文の1行を描く（行頭の [hh:mm:ss] は小さく、メモはラベルの文字で、途切れは控えめに）
function lineElement(line) {
    const p = document.createElement('p');
    p.className = 't-line';
    const m = LINE_RE.exec(line);
    let body = line;
    if (m) {
        const stamp = document.createElement('span');
        stamp.className = 't-stamp';
        stamp.textContent = m[1];
        p.appendChild(stamp);
        body = m[2];
    }
    const memo = MEMO_RE.exec(body);
    if (memo) {
        p.classList.add('memo-line');
        const label = document.createElement('span');
        label.className = 'memo-label';
        label.textContent = memo[1];
        p.appendChild(label);
        body = memo[2];
    } else if (body.indexOf('※この時刻から') === 0) {
        p.classList.add('t-gap');
    }
    p.appendChild(document.createTextNode(body));
    return p;
}

// ページの一番下の近くを見ているか（上へ戻って読んでいる最中は、引き戻さない）
function nearBottom() {
    const el = document.documentElement;
    return window.innerHeight + window.scrollY >= el.scrollHeight - 160;
}

function appendLine(line) {
    const text = String(line || '').trim();
    if (!text) return;
    const follow = nearBottom();
    $('transcriptionDisplay').appendChild(lineElement(text));
    updatePlaceholder();
    if (follow) window.scrollTo(0, document.documentElement.scrollHeight);
}

function renderTranscript(text) {
    const box = $('transcriptionDisplay');
    box.textContent = '';
    const frag = document.createDocumentFragment();
    String(text || '').split(/\r\n|\r|\n/).forEach((l) => {
        const t = l.trim();
        if (t) frag.appendChild(lineElement(t));
    });
    box.appendChild(frag);
    $('interimDisplay').textContent = '';
    updatePlaceholder();
}

// 文字起こしが動いていないときの案内（なぜ出ないか・どうすれば出るかを1行で）
function srHintText() {
    if (state.srFreshInstall) return 'Chrome をいったん全部閉じて開き直すと、文字起こしが使えます（準備のあとに1回だけ）';
    if (state.srRestartNotice) return RESTART_HELP;
    if (state.srInstall === 'installing' || state.srAvail === 'downloading') return '文字起こしの準備中です。終わると文字が出ます';
    if (state.srInstall === 'failed') return '文字起こしの準備ができませんでした。上の［もう一度］を押してください';
    if (state.srAvail === 'downloadable') return '文字起こしは、上の［準備する］を押すと始まります（初回だけ）';
    if (IS_MOBILE) return 'この端末では文字起こしは出ません（録音とメモは使えます）';
    if (BROWSER !== 'chrome') return 'このブラウザでは文字起こしは出ません。Chrome で開いてください（録音とメモは使えます）';
    return 'この Chrome では文字起こしが使えません（録音とメモは使えます）';
}

function updatePlaceholder() {
    const has = $('transcriptionDisplay').childElementCount > 0;
    const el = $('transcriptionPlaceholder');
    if (has) {
        el.hidden = true;
        return;
    }
    const srOk = state.srAvail === 'available' || state.srAvail === 'checking';
    let text;
    if (state.phase === 'recording') {
        text = ((rec && rec.transcriber) || state.srAvail === 'checking') && !state.srRestartNotice && !state.srFreshInstall
            ? '話すと、ここに文字が出ます' : srHintText();
    }
    else if (current) text = '（文字起こしはありません）';
    else text = srOk ? '録音すると、ここに文字起こしが出ます' : srHintText();
    el.textContent = text;
    el.hidden = false;
}

// 録音中に「使える」になったら（起動直後の確認が済んだ・［準備する］が終わった）、その時点から文字起こしを始める
function maybeStartTranscription() {
    const r = rec;
    if (!r || state.phase !== 'recording' || r.stopped || r.transcriber || !r.graph || !r.graph.srTrack) return;
    if (state.srAvail !== 'available') return;
    startTranscription(r);
    updatePlaceholder();
}

function renderSessionHeader() {
    const title = $('sessionTitle');
    const meta = $('sessionMeta');
    if (!current) {
        title.hidden = true;
        meta.hidden = true;
        return;
    }
    title.textContent = current.title || '（無題）';
    title.hidden = false;
    const parts = [formatSessionDate(current)];
    if (current.status === 'recording') parts.push('録音中');
    if (current.status === 'interrupted') parts.push('中断');
    meta.textContent = parts.filter(Boolean).join('　');
    meta.hidden = !meta.textContent;
}

function renderSession() {
    renderSessionHeader();
    renderTranscript(current ? current.text : '');
    if (state.phase === 'idle') {
        const sec = current ? (typeof current.durationSec === 'number' ? current.durationSec : lastStampSec(current.text)) : 0;
        $('timerDisplay').textContent = secToStamp(sec || 0);
    }
}

// ---- 4. 書き出し（iPhone のため、Blob とファイル名を先に作っておき、タップの中では同期で保存する） ----
function audioOf(s) {
    if (!s) return null;
    if (s.audioBlob && s.audioBlob.size > 0) return s.audioBlob;
    if (s._segAudio && s._segAudio.size > 0) return s._segAudio; // まとめられなかった録音（断片をつないだもの）
    if (s._memAudio && s._memAudio.size > 0) return s._memAudio; // 保存できず、メモリにだけある録音
    return null;
}

function prepareExports() {
    if (!current) {
        exportsReady = { txt: null, audio: null };
        return;
    }
    const when = current.startedAt || current.timestamp;
    const audio = audioOf(current);
    exportsReady = {
        txt: { blob: makeTextBlob(buildTranscriptTxt(current)), name: transcriptTxtFilename(current.title, when) },
        audio: audio ? { blob: audio, name: audioFilename(current.title, when, current.mimeType || audio.type) } : null,
    };
}

// ---- 5. 保存の表示 ----
// 失敗している保存の種類（'create' 'text' 'audio' 'final' 'late' 'memo' 'title' 'delete'）。
// 帯は、失敗した種類がみな保存できるようになるまで出したまま（閉じるボタンでも消せる）
const failingSaves = new Set();

function markSaved(kind) {
    const el = $('lastSavedText');
    el.textContent = '保存 ' + formatClock(Date.now());
    el.hidden = false;
    if (kind) failingSaves.delete(kind);
    if (!failingSaves.size) setShown('saveErrorBanner', false);
}

function onSaveError(err, kind) {
    console.error('保存に失敗しました', kind, err);
    failingSaves.add(kind || 'other');
    const recording = state.phase === 'recording';
    let text = db.isQuotaError(err) ? '空き容量が足りず保存できませんでした' : '保存できませんでした';
    if (recording) text += '（録音は続いています）';
    $('saveErrorText').textContent = text;
    setShown('saveErrorBanner', true);
}

async function refreshStorageUsage() {
    const el = $('storageUsageText');
    try {
        if (!navigator.storage || !navigator.storage.estimate) throw new Error('no estimate');
        const est = await navigator.storage.estimate();
        const mb = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'GB' : Math.max(0, Math.round(n / 1e6)) + 'MB');
        el.textContent = '容量：' + mb(est.usage || 0) + ' 使用（空き ' + mb(Math.max(0, (est.quota || 0) - (est.usage || 0))) + '）';
    } catch (e) {
        el.textContent = '';
    }
}

// ---- 6. ×で閉じるときの警告（失うものがあるときだけ付ける） ----
function onBeforeUnload(e) {
    e.preventDefault();
    e.returnValue = '';
    return '';
}

function needsLeaveGuard() {
    if (state.phase !== 'idle' || draining.size > 0 || unsavedAudio.size > 0) return true;
    const memo = $('manualMemoInput');
    if (memo && memo.value.trim()) return true;
    const prompt = $('promptModal');
    return !!(prompt && !prompt.hidden);
}

function updateLeaveGuard() {
    const need = needsLeaveGuard();
    if (need && !guardOn) {
        window.addEventListener('beforeunload', onBeforeUnload);
        guardOn = true;
    } else if (!need && guardOn) {
        window.removeEventListener('beforeunload', onBeforeUnload);
        guardOn = false;
    }
}

// ---- 7. 画面の押せる/押せない（状態が変わったら必ずここを通す） ----
function updateUI() {
    const recording = state.phase === 'recording';
    const busy = isBusy();
    const recBtn = $('recBtn');
    recBtn.classList.toggle('is-recording', recording);
    $('recBtnText').textContent = recording ? '録音停止' : '録音開始';
    recBtn.disabled = IS_INAPP || state.phase === 'starting' || state.phase === 'stopping';
    setDisabled('newSessionBtn', busy);
    document.querySelectorAll('.source-btn').forEach((b) => {
        b.disabled = busy;
        b.setAttribute('aria-checked', String(b.getAttribute('data-source') === state.source));
    });
    setShown('sourceHint', CAN_PC && state.source === 'mix' && !busy);
    setDisabled('micSelect', busy);
    setShown('meters', recording);
    setShown('meterMicRow', !(recording && rec && !rec.micStream)); // PCの音だけの録音ではマイクの波形を出さない
    const pcOn = !!(recording && rec && rec.pcActive);
    setShown('meterPcRow', pcOn);
    setShown('pcRecIndicator', pcOn);
    setShown('historyList', !pcOn); // PCの音を録っている間は、会議の名前が画面共有で映らないよう履歴を隠す
    setShown('historyPrivateNote', pcOn);
    setShown('stopPcAudioBtn', pcOn && !!rec.micStream); // PCの音だけの録音は［録音停止］で止める
    setShown('pcSilentNote', pcOn && rec.pcSilentShown);
    setShown('mobileRecNote', recording && IS_MOBILE);
    setShown('exportBar', !busy && !!current);
    setDisabled('downloadTransBtn', (!!current && draining.has(current)) || !exportsReady.txt);
    setDisabled('downloadAudioBtn', !exportsReady.audio);
    const memoOk = recording || (!busy && !!current);
    setDisabled('manualMemoInput', !memoOk);
    setDisabled('addMemoBtn', !memoOk);
    document.querySelectorAll('.memo-type-btn').forEach((b) => {
        b.setAttribute('aria-checked', String(b.getAttribute('data-memo-type') === state.memoType));
    });
    document.querySelectorAll('#historyList .history-open').forEach((b) => { b.disabled = busy; });
    document.querySelectorAll('#historyList .history-delete').forEach((b) => {
        b.disabled = busy && !!rec && String(rec.sessionId) === b.getAttribute('data-id');
    });
    updatePlaceholder();
    updateLeaveGuard();
}

// ---- 8. 起動時の後始末（前回 'recording' のまま残った記録を「中断」にし、音声の断片をつなぐ） ----
// ほかの窓（タブ・インストールした窓）で録音中の記録は触らない：その窓が Web Locks の鍵を持っている。
// Web Locks が無い端末では、最近書かれた記録を録音中とみなす。
async function lockHeld(id) {
    if (!(navigator.locks && typeof navigator.locks.request === 'function')) return null;
    try {
        return await navigator.locks.request(LOCK_PREFIX + id, { ifAvailable: true }, (lock) => lock === null);
    } catch (e) {
        return null;
    }
}

async function recordingElsewhere(s) {
    const age = Date.now() - (s.updatedAt || s.startedAt || s.timestamp || 0);
    const held = await lockHeld(s.id);
    if (held === true) return true;
    if (held === false) return age < FRESH_WITH_LOCK_MS;
    return age < FRESH_WITHOUT_LOCK_MS;
}

async function recoverStaleSessions() {
    const result = { interrupted: 0, skipped: 0 };
    let list;
    try {
        list = await db.getAllSessions();
    } catch (e) {
        return result;
    }
    for (const s of list) {
        if (s.status !== 'recording') continue;
        if (rec && rec.sessionId === s.id) continue;
        if (await recordingElsewhere(s)) {
            result.skipped++;
            continue;
        }
        let segs = [];
        try { segs = await db.getSegments(s.id); } catch (e) { segs = null; }
        const hasText = !!(s.text && String(s.text).trim());
        const segBytes = (segs || []).reduce((n, x) => n + (x.blob ? x.blob.size : 0), 0);
        const hasAudio = segBytes > 0 || !!(s.audioBlob && s.audioBlob.size > 0);
        if (segs && !hasText && !hasAudio) {
            // 録れていなかった記録（幽霊）は残さない
            try { await db.deleteSession(s.id); } catch (e) { /* 次の起動でもう一度 */ }
            db.deleteSegments(s.id).catch(() => {});
            continue;
        }
        const patch = { status: 'interrupted', updatedAt: Date.now() };
        if (typeof s.durationSec !== 'number' && s.startedAt) {
            patch.durationSec = Math.max(0, Math.round(((s.updatedAt || s.startedAt) - s.startedAt) / 1000));
        }
        if (segs && segs.length) patch.audioBlob = new Blob(segs.map((x) => x.blob), { type: s.mimeType || segs[0].blob.type || '' });
        try {
            await db.patchSession(s.id, patch);
            if (patch.audioBlob) db.deleteSegments(s.id).catch(() => {}); // まとめ終わってから消す（消せなくても次の起動で消す）
        } catch (e) {
            // 容量不足などでまとめられないときは、断片を残したまま「中断」にだけする（書き出しは断片をつないで出す）
            delete patch.audioBlob;
            try { await db.patchSession(s.id, patch); } catch (e2) { /* 次の起動でもう一度 */ }
        }
        result.interrupted++;
    }
    // 断片の片付け：会議が無いものは消す。会議に音声がまとまっていれば消す。
    // まとまっていない会議（停止のときに容量不足などで入れられなかった）は、ここでつないで入れ直してから消す
    try {
        const byId = new Map(list.map((s) => [s.id, s]));
        for (const id of await db.segmentSessionIds()) {
            if (rec && rec.sessionId === id) continue;
            const s = byId.get(id);
            if (s && s.status === 'recording') continue;
            if (!s) {
                if (await lockHeld(id)) continue; // 一覧を読んだあとに、ほかの窓で始まった録音
                const fresh = await db.getSession(id);
                if (fresh) continue;
                await db.deleteSegments(id);
            } else if (s.audioBlob && s.audioBlob.size > 0) {
                await db.deleteSegments(id);
            } else {
                try {
                    const blob = await db.assembleAudio(id, [], s.mimeType);
                    if (blob && blob.size > 0) {
                        await db.patchSession(id, { audioBlob: blob, updatedAt: Date.now() });
                        await db.deleteSegments(id);
                    }
                } catch (e) { /* まだ入らない（容量不足など）：断片は残し、書き出しは断片をつないで出す */ }
            }
        }
    } catch (e) {
        // 片付けは次の起動でもう一度
    }
    return result;
}

// ---- 9. 履歴 ----
function sessionSortKey(s) {
    return s.startedAt || s.timestamp || 0;
}

async function renderHistory() {
    const list = $('historyList');
    let sessions = [];
    if (state.dbMode === 'ok') {
        try {
            sessions = await db.getAllSessions();
        } catch (e) {
            console.error(e);
        }
    }
    sessions.sort((a, b) => sessionSortKey(b) - sessionSortKey(a));
    list.textContent = '';
    if (!sessions.length) {
        const li = document.createElement('li');
        li.className = 'history-empty';
        li.textContent = state.dbMode === 'ok' ? 'まだ記録はありません' : 'この設定では履歴を残せません';
        list.appendChild(li);
        updateUI();
        return;
    }
    const frag = document.createDocumentFragment();
    sessions.forEach((s) => {
        const li = document.createElement('li');
        li.className = 'history-item';
        if (current && current.id === s.id) li.setAttribute('aria-current', 'true');

        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'history-open';
        open.setAttribute('data-id', String(s.id));
        const title = document.createElement('span');
        title.className = 'history-title';
        title.textContent = s.title || '（無題）';
        const meta = document.createElement('span');
        meta.className = 'history-meta';
        meta.textContent = formatSessionDate(s);
        if (s.status === 'interrupted' || s.status === 'recording') {
            const badge = document.createElement('span');
            badge.className = 'badge ' + (s.status === 'interrupted' ? 'badge-interrupted' : 'badge-recording');
            badge.textContent = s.status === 'interrupted' ? '中断' : '録音中';
            meta.appendChild(badge);
        }
        open.appendChild(title);
        open.appendChild(meta);

        const rename = document.createElement('button');
        rename.type = 'button';
        rename.className = 'history-action history-rename';
        rename.setAttribute('aria-label', '名前を変える');
        rename.setAttribute('data-id', String(s.id));
        rename.innerHTML = '<i data-lucide="pencil" aria-hidden="true"></i>';

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'history-action history-delete';
        del.setAttribute('aria-label', '削除');
        del.setAttribute('data-id', String(s.id));
        del.innerHTML = '<i data-lucide="trash" aria-hidden="true"></i>';

        li.appendChild(open);
        li.appendChild(rename);
        li.appendChild(del);
        frag.appendChild(li);
    });
    list.appendChild(frag);
    renderIcons(list);
    updateUI();
}

async function openSession(id) {
    if (isBusy()) {
        showToast('録音中は切り替えられません');
        return;
    }
    let s;
    try {
        s = await db.getSession(id);
    } catch (e) {
        showToast('開けませんでした', 'error');
        return;
    }
    if (!s) {
        showToast('記録が見つかりません', 'error');
        renderHistory();
        return;
    }
    if (!(s.audioBlob && s.audioBlob.size > 0)) {
        try {
            const blob = await db.assembleAudio(s.id, [], s.mimeType);
            if (blob && blob.size > 0) s._segAudio = blob;
        } catch (e) { /* 断片が読めなければ音声なし */ }
    }
    if (isBusy()) return; // 読んでいるあいだに録音が始まった
    current = s;
    renderSession();
    prepareExports();
    closeSidebar();
    renderHistory();
}

async function renameSession(id) {
    let s;
    try { s = await db.getSession(id); } catch (e) { s = null; }
    if (!s) return;
    const name = await showPrompt({ title: '名前を変える', defaultValue: s.title || '', okLabel: '保存', cancelLabel: 'やめる' });
    updateLeaveGuard();
    if (name == null || !name.trim()) return;
    const title = name.trim();
    try {
        await db.patchSession(id, { title, updatedAt: Date.now() });
        markSaved('title');
    } catch (e) {
        onSaveError(e, 'title');
        return;
    }
    if (current && current.id === id) {
        current.title = title;
        renderSessionHeader();
        prepareExports();
    }
    if (rec && rec.session && rec.sessionId === id) rec.session.title = title;
    renderHistory();
}

async function deleteSessionFlow(id) {
    if (rec && rec.sessionId === id) {
        showToast('録音中の会議は消せません');
        return;
    }
    // ほかの画面（タブ・窓）で録音中の会議も消させない（消すと、その画面の録音が保存先を失う）
    let s = null;
    try { s = await db.getSession(id); } catch (e) { s = null; }
    if (s && s.status === 'recording' && await recordingElsewhere(s)) {
        showToast('ほかの画面で録音中の会議は消せません');
        return;
    }
    const r = await showConfirm({
        title: 'この記録を削除しますか',
        message: '録音と文字起こしが消えます。元に戻せません',
        okLabel: '削除', cancelLabel: 'やめる', focusCancel: true,
    });
    if (r !== 'ok') return;
    try {
        await db.deleteSession(id);
    } catch (e) {
        onSaveError(e, 'delete');
        return;
    }
    db.deleteSegments(id).catch(() => {});
    if (current && current.id === id && !isBusy()) {
        current = null;
        renderSession();
        prepareExports();
    }
    renderHistory();
    refreshStorageUsage();
}

// ---- 10. 録音の開始 ----
function requestWakeLock() {
    try {
        if (!('wakeLock' in navigator) || document.hidden || wakeLock) return;
        navigator.wakeLock.request('screen').then((wl) => {
            // 返事が来る前に録音をやめていたら、すぐ放す（点灯したままにしない）
            if (state.phase === 'idle' || wakeLock) {
                wl.release().catch(() => {});
                return;
            }
            wakeLock = wl;
            if (wl.addEventListener) wl.addEventListener('release', () => { if (wakeLock === wl) wakeLock = null; });
        }).catch(() => {});
    } catch (e) { /* 画面が消えないようにできなくても録音はできる */ }
}

function releaseWakeLock() {
    const wl = wakeLock;
    wakeLock = null;
    if (wl) wl.release().catch(() => {});
}

// タップの直後（await の前）に呼ぶもの：画面共有・AudioContext・画面の点灯・保存の固定
function kickCapture(useMix) {
    const k = { pcP: null, ctx: null };
    if (useMix) k.pcP = requestPcAudio(); // 最初に呼ぶ（タップの直後でないと断られる）
    k.ctx = createAudioContext();
    requestWakeLock();
    if (ls.get('persistAsked') !== '1') {
        ls.set('persistAsked', '1');
        try {
            if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
        } catch (e) { /* 無くてもよい */ }
    }
    return k;
}

function selectedMicId() {
    const sel = $('micSelect');
    return sel && sel.value ? sel.value : undefined;
}

// 画面共有の結果 → 音の入った stream / null（マイクだけで録音）。やめたら CANCEL を投げる
async function obtainPcStream(pcP) {
    let p = pcP;
    for (;;) {
        let stream;
        try {
            stream = await p;
        } catch (e) {
            const r = await showConfirm({ title: 'PCの音', message: 'PCの音を使わずに、マイクだけで録音しますか', okLabel: 'マイクだけで録音', cancelLabel: 'やめる' });
            if (r === 'ok') return null;
            throw CANCEL;
        }
        if (hasAudio(stream)) return stream;
        stopStream(stream);
        let retry = null;
        const r = await showConfirm({
            title: 'PCの音が入っていません', message: SOURCE_HINT, okLabel: 'やり直す', cancelLabel: 'マイクだけで録音',
            onOkTap: () => { retry = requestPcAudio(); },
        });
        if (r === 'ok' && retry) {
            p = retry;
            continue;
        }
        if (r === 'cancel') return null;
        throw CANCEL;
    }
}

async function startFlow() {
    if (state.phase !== 'idle' || IS_INAPP) return;
    const useMix = CAN_PC && state.source === 'mix';
    const needNotice = ls.get('noticeSeen') !== '1';
    state.phase = 'starting';
    updateUI();
    let kick = null;
    const doKick = () => { kick = kickCapture(useMix); };
    try {
        if (needNotice) {
            const r = await showConfirm({
                title: NOTICE_TITLE, message: NOTICE_MESSAGE, okLabel: 'わかりました', cancelLabel: 'やめる',
                onOkTap: useMix ? null : doKick,
            });
            if (r !== 'ok') throw CANCEL;
            ls.set('noticeSeen', '1');
        }
        if (useMix) {
            const r = await showConfirm({ title: PC_CONFIRM_TITLE, message: PC_CONFIRM_MESSAGE, okLabel: '開始', cancelLabel: 'やめる', onOkTap: doKick });
            if (r !== 'ok') throw CANCEL;
        } else if (!needNotice) {
            doKick(); // まだ録音開始のタップの中（await の前）
        }
        await continueStart(kick || kickCapture(false));
    } catch (e) {
        if (kick && kick.pcP) kick.pcP.then(stopStream, () => {});
        stopCapture({ streams: [], ctx: kick && kick.ctx });
        releaseWakeLock();
        state.phase = 'idle';
        rec = null;
        updateUI();
        if (e !== CANCEL) {
            console.error(e);
            showToast('録音を始められませんでした', 'error');
        }
    }
}

async function continueStart(kick) {
    const ctx = kick.ctx;
    let pcStream = null;
    let micStream = null;
    let graph = null;
    try {
        if (kick.pcP) pcStream = await obtainPcStream(kick.pcP);
        try {
            micStream = await requestMic(selectedMicId());
        } catch (e) {
            if (!pcStream) {
                showToast('マイクが使えません。ブラウザの設定でマイクを許可してください', 'error');
                throw CANCEL;
            }
            const r = await showConfirm({ title: 'マイクが使えません', message: 'PCの音だけで録音しますか', okLabel: 'PCの音だけで録音', cancelLabel: 'やめる' });
            if (r !== 'ok') throw CANCEL;
            micStream = null;
        }
        populateMics(); // 許可が取れると、マイクの名前が読めるようになる
        graph = buildGraph(ctx, { micStream, pcStream });
        const mimeType = pickMimeType((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
        const opts = { audioBitsPerSecond: 48000 };
        if (mimeType) opts.mimeType = mimeType;
        const mr = new MediaRecorder(graph.recordStream, opts);
        const r = {
            mediaRecorder: mr, micStream, pcStream, graph, ctx, mimeType: mimeType || mr.mimeType || '',
            pcActive: hasAudio(pcStream), startedAt: 0, sessionId: null, session: null, createP: null,
            chunks: [], chunkCount: 0, seq: 0, flushing: null, textDirty: false, savingText: null,
            transcriber: null, stopMeters: null, waveMic: null, wavePc: null, timerId: null,
            pcLastSoundAt: 0, pcSilentShown: false, gapOpen: false, stopped: false, stoppedAtSec: null,
            lateAdded: false, releaseLock: null, ended: false, onStopResolve: null,
        };
        rec = r;
        mr.ondataavailable = (e) => onData(r, e);
        mr.onstart = () => onRecorderStart(r);
        mr.onstop = () => onRecorderStop(r);
        mr.onerror = (e) => {
            console.error('録音のエラー', e && e.error);
            if (rec !== r) return;
            if (state.phase === 'recording') stopRecording('error');
            else if (state.phase === 'starting') abortStart(r);
        };
        mr.start(1000);
        // 始まった知らせ（onstart）が来ないまま固まらないように
        r.startGuard = setTimeout(() => { if (rec === r && state.phase === 'starting') abortStart(r); }, 5000);
    } catch (e) {
        stopCapture({ streams: [pcStream, micStream, graph && graph.recordStream], srTrack: graph && graph.srTrack, ctx });
        throw e;
    }
}

// 録音機が始まらなかった：取れたトラックを全部止めて、待機に戻す
function abortStart(r) {
    clearTimeout(r.startGuard);
    try { if (r.mediaRecorder.state !== 'inactive') r.mediaRecorder.stop(); } catch (e) { /* もう止まっている */ }
    stopCapture({ streams: [r.micStream, r.pcStream, r.graph && r.graph.recordStream], srTrack: r.graph && r.graph.srTrack, ctx: r.ctx });
    releaseWakeLock();
    rec = null;
    state.phase = 'idle';
    updateUI();
    showToast('録音を始められませんでした', 'error');
}

function onRecorderStart(r) {
    if (rec !== r) return;
    clearTimeout(r.startGuard);
    r.startedAt = Date.now();
    state.phase = 'recording';
    state.srStoppedNotice = false;
    state.srBannerClosed = false; // 準備が要るなら、録音のたびに帯をもう一度見せる
    diag('録音開始 使えるか=' + state.srAvail + (state.srInstall ? ' 準備=' + state.srInstall : '') + (state.srFreshInstall ? ' 開き直し待ち' : ''));
    r.session = {
        id: null, title: provisionalTitle(r.startedAt), text: '', rawText: '', audioBlob: null,
        timestamp: r.startedAt, startedAt: r.startedAt, status: 'recording', mimeType: r.mimeType, updatedAt: r.startedAt,
    };
    current = r.session;
    prepareExports();
    renderSession();
    $('timerDisplay').textContent = '00:00:00';
    updateUI(); // 先に波形の枠を見せる（隠れたままだと幅が0になる）
    r.timerId = setInterval(() => { // 経過時間の表示だけ（保存には使わない）
        if (rec === r && state.phase === 'recording') $('timerDisplay').textContent = secToStamp(elapsedSec(r));
    }, 500);
    try { r.waveMic = r.micStream ? createWave($('waveMic'), { color: WAVE_COLOR_MIC }) : null; } catch (e) { r.waveMic = null; }
    try { r.wavePc = r.pcActive ? createWave($('wavePc'), { color: WAVE_COLOR_PC }) : null; } catch (e) { r.wavePc = null; }
    r.pcLastSoundAt = r.startedAt;
    r.stopMeters = startMeters(r.graph, (lv) => onLevels(r, lv));
    watchTracks(r);
    // 文字起こしは「使える」なら今から。起動直後で確かめている最中なら、確かめ終わった時点で決める。
    // 録音の途中で［準備する］が終わったときも、その時点から始める（maybeStartTranscription）
    maybeStartTranscription();
    if (state.srAvail === 'checking' && availP) availP.then(maybeStartTranscription);
    refreshSrBanner();
    updatePlaceholder();
    ensureSessionRecord(r);
}

// 記録を作る（作成中なら同じものを待つ＝二重に作らない。失敗していたら作り直す）
function ensureSessionRecord(r) {
    if (state.dbMode !== 'ok' || r.sessionId != null) return r.createP;
    if (!r.creating) {
        r.creating = true;
        r.createP = createSessionRecord(r).finally(() => { r.creating = false; });
    }
    return r.createP;
}

async function createSessionRecord(r) {
    if (state.dbMode !== 'ok' || r.sessionId != null) return;
    const s = r.session;
    try {
        const id = await db.addSession({
            title: s.title, text: s.text, rawText: s.rawText, audioBlob: null, timestamp: s.timestamp,
            startedAt: s.startedAt, status: 'recording', mimeType: s.mimeType, updatedAt: Date.now(),
        });
        r.sessionId = id;
        s.id = id;
        acquireLock(r, id);
        markSaved('create');
        renderHistory();
    } catch (e) {
        onSaveError(e, 'create'); // 次の自動保存でもう一度作る
    }
}

function acquireLock(r, id) {
    if (!(navigator.locks && typeof navigator.locks.request === 'function')) return;
    try {
        navigator.locks.request(LOCK_PREFIX + id, () => new Promise((resolve) => {
            if (r.ended) resolve();
            else r.releaseLock = resolve;
        })).catch(() => {});
    } catch (e) { /* 鍵が無くても、updatedAt の新しさで守る */ }
}

function watchTracks(r) {
    const mic = r.micStream && r.micStream.getAudioTracks()[0];
    if (mic) {
        mic.addEventListener('mute', () => addGapLine(r));
        mic.addEventListener('ended', () => addGapLine(r));
        mic.addEventListener('unmute', () => {
            if (rec !== r || !r.gapOpen || r.stopped) return;
            r.gapOpen = false;
            addTextLine(r, '[' + secToStamp(elapsedSec(r)) + '] ' + GAP_BACK_LINE);
        });
    }
    const pc = r.pcStream && r.pcStream.getAudioTracks()[0];
    if (pc) pc.addEventListener('ended', () => endPcAudio(r, true));
}

function addTextLine(r, line) {
    r.session.text += '\n' + line + '\n';
    r.textDirty = true;
    if (current === r.session) appendLine(line);
    saveText(r);
}

function addGapLine(r) {
    if (rec !== r || r.gapOpen || r.stopped) return;
    r.gapOpen = true;
    addTextLine(r, '[' + secToStamp(elapsedSec(r)) + '] ' + GAP_LINE);
}

// PCの音だけを止める（Chrome の［共有を停止］でも同じ）。マイクがあれば録音は続ける
function endPcAudio(r, byBrowser) {
    if (rec !== r || !r.pcActive || r.stopped) return;
    if (!r.micStream) {
        stopRecording('pc-ended'); // マイクが無い録音は、PCの音が止まったら終わり
        return;
    }
    r.pcActive = false;
    stopStream(r.pcStream);
    if (r.wavePc) { r.wavePc.destroy(); r.wavePc = null; }
    if (byBrowser) showToast('PCの音の取り込みが止まりました（マイクは録音中）');
    updateUI();
}

function onLevels(r, lv) {
    if (rec !== r) return;
    if (lv.mic != null && r.waveMic) r.waveMic.push(lv.mic);
    if (lv.pc != null && r.wavePc) r.wavePc.push(lv.pc);
    if (!r.pcActive || lv.pc == null) return;
    const now = Date.now();
    if (lv.pc >= PC_SILENT_LEVEL) {
        r.pcLastSoundAt = now;
        if (r.pcSilentShown) { r.pcSilentShown = false; updateUI(); }
    } else if (!r.pcSilentShown && now - r.pcLastSoundAt >= PC_SILENT_MS) {
        r.pcSilentShown = true;
        updateUI();
    }
}

// ---- 11. 文字起こし（端末内だけ） ----
function startTranscription(r) {
    if (DIAG) {
        const mt = r.micStream && r.micStream.getAudioTracks()[0];
        const ms = mt && mt.getSettings ? mt.getSettings() : {};
        const st = r.graph.srTrack;
        const ss = st && st.getSettings ? st.getSettings() : {};
        diag('v' + APP_VERSION + ' ' + (UA.match(/Chrome\/[\d.]+/) || [''])[0] + ' 使えるか=' + state.srAvail);
        diag('マイク ' + (mt ? mt.label : 'なし') + ' ' + ms.channelCount + 'ch ' + ms.sampleRate + 'Hz');
        diag('文字起こしに渡す音 ' + (st ? st.readyState + ' ' + ss.channelCount + 'ch ' + ss.sampleRate + 'Hz' : 'なし') + (r.pcActive ? '（PCの音あり）' : ''));
    }
    r.transcriber = startTranscriber({
        track: r.graph.srTrack,
        onFinal: (text) => onFinal(r, text),
        onDebug: DIAG ? diag : undefined,
        onInterim: (text) => {
            if (text && state.srRestartNotice) { state.srRestartNotice = false; refreshSrBanner(); }
            // 話し始めの時刻（その文の最初の途中結果）を覚えておき、確定したときの行頭の時刻に使う（音声の位置と合わせやすく）
            if (text && r.utterStartSec == null) r.utterStartSec = r.stoppedAtSec != null ? r.stoppedAtSec : elapsedSec(r);
            if (current === r.session) $('interimDisplay').textContent = tidyTranscript(text, { removeFillers: false });
        },
        onNotice: (kind) => {
            if (rec !== r || r.stopped) return;
            if (kind === 'stopped') state.srStoppedNotice = true;
            if (kind === 'restart') state.srRestartNotice = true;
            refreshSrBanner();
            updatePlaceholder();
        },
    });
}

function onFinal(r, raw) {
    if (state.srRestartNotice) { state.srRestartNotice = false; refreshSrBanner(); }
    const startSec = r.utterStartSec;
    r.utterStartSec = null;
    const rawClean = tidyTranscript(raw, { removeFillers: false });
    if (!rawClean) return;
    const stamp = secToStamp(startSec != null ? startSec : (r.stoppedAtSec != null ? r.stoppedAtSec : elapsedSec(r)));
    r.session.rawText += '\n[' + stamp + '] ' + rawClean + '\n';
    const cleaned = state.fillerOn ? tidyTranscript(raw, { removeFillers: true }) : rawClean;
    r.textDirty = true;
    if (r.stopped) r.lateAdded = true;
    if (!cleaned) return;
    const line = '[' + stamp + '] ' + cleaned;
    r.session.text += '\n' + line + '\n';
    if (current === r.session) appendLine(line);
}

// ---- 12. 録音中の自動保存（録音のデータの回数で回す） ----
function onData(r, e) {
    if (e.data && e.data.size > 0) r.chunks.push(e.data);
    r.chunkCount++;
    if (r.stopped) return;
    if (r.chunkCount % TEXT_SAVE_EVERY === 0) saveText(r);
    if (r.chunkCount % AUDIO_SAVE_EVERY === 0) flushAudio(r);
}

function saveText(r, force) {
    if (state.dbMode !== 'ok' || r.stopped) return null;
    if (r.sessionId == null) return ensureSessionRecord(r);
    if (!r.textDirty && !force) return null;
    if (r.savingText) return r.savingText;
    r.textDirty = false;
    r.savingText = db.patchSession(r.sessionId, { text: r.session.text, rawText: r.session.rawText, updatedAt: Date.now() })
        .then(() => markSaved('text'))
        .catch((err) => { r.textDirty = true; onSaveError(err, 'text'); })
        .finally(() => { r.savingText = null; });
    return r.savingText;
}

// まだ保存していない音声を、断片として1つ足す（前の保存が終わっていなければ飛ばす）
function flushAudio(r) {
    if (state.dbMode !== 'ok' || r.sessionId == null || r.flushing || !r.chunks.length) return r.flushing;
    const take = r.chunks.length;
    const blob = new Blob(r.chunks.slice(0, take), { type: r.mimeType || '' });
    const seq = r.seq;
    r.flushing = db.addSegment({ sessionId: r.sessionId, seq, blob, bytes: blob.size, createdAt: Date.now() })
        .then(() => {
            r.seq = seq + 1;
            r.chunks.splice(0, take); // 保存できた分だけメモリから外す（長く録ってもメモリが増えない）
            markSaved('audio');
            return db.patchSession(r.sessionId, { updatedAt: Date.now() }).catch(() => {});
        })
        .catch((err) => onSaveError(err, 'audio'))
        .finally(() => { r.flushing = null; });
    return r.flushing;
}

// ---- 13. 録音の停止（止めたらすぐ最後の保存。名前を聞くのは保存のあと） ----
function onRecorderStop(r) {
    if (r.onStopResolve) {
        r.onStopResolve();
        return;
    }
    // こちらから止めていないのに止まった（マイクが外れた・エラーなど）→ 同じ保存の流れを通す
    if (rec === r && state.phase === 'recording') stopRecording('auto');
}

function stopRecorder(r) {
    return new Promise((resolve) => {
        const mr = r.mediaRecorder;
        if (!mr || mr.state === 'inactive') {
            resolve();
            return;
        }
        const t = setTimeout(resolve, 5000);
        r.onStopResolve = () => { clearTimeout(t); resolve(); };
        try {
            mr.stop();
        } catch (e) {
            clearTimeout(t);
            resolve();
        }
    });
}

function releaseCapture(r) {
    if (r.timerId) clearInterval(r.timerId);
    r.timerId = null;
    stopCapture({
        streams: [r.micStream, r.pcStream, r.graph && r.graph.recordStream],
        srTrack: r.graph && r.graph.srTrack,
        ctx: r.ctx,
        stopMeters: r.stopMeters,
    });
    if (r.waveMic) r.waveMic.destroy();
    if (r.wavePc) r.wavePc.destroy();
    r.waveMic = null;
    r.wavePc = null;
    releaseWakeLock();
}

const STOP_REASON_TOAST = {
    auto: '録音が止まりました（マイクが外れた可能性があります）。ここまで保存しました',
    error: '録音でエラーが起きたため止めました。ここまで保存しました',
    'pc-ended': 'PCの音の取り込みが止まったため、録音を止めました。ここまで保存しました',
};
const STOP_WAIT_MS = 10000;          // 停止のとき、保存の返事を待つ上限（返らない端末で固まらないように）
const TIMEOUT = { timedOut: true };

// 失敗しても例外を投げず、上限の時間を過ぎたら TIMEOUT を返す
function settle(p, ms) {
    const safe = Promise.resolve(p).then((v) => v, (e) => ({ error: e }));
    return Promise.race([safe, new Promise((res) => setTimeout(() => res(TIMEOUT), ms || STOP_WAIT_MS))]);
}

// 停止のあと、最後の文を待っている会議（会議ごとに持つ。続けて録音しても混ざらない）
const draining = new Set();
// 音声がメモリにしか無い会議（保存できない設定・保存の失敗）。［音声］で書き出すまで、閉じるときの警告を付ける
const unsavedAudio = new Set();

async function stopRecording(reason) {
    const r = rec;
    if (!r || state.phase !== 'recording') return;
    state.phase = 'stopping';
    r.stopped = true;
    r.stoppedAtSec = elapsedSec(r);
    const s = r.session;
    if (r.transcriber) draining.add(s);
    updateUI();
    const drained = r.transcriber ? r.transcriber.stop() : Promise.resolve();
    await stopRecorder(r);
    releaseCapture(r); // マイクと画面共有の表示を、停止から1秒以内に消す

    const dbOk = state.dbMode === 'ok';
    let stuck = false; // DB が返事をしない
    if (dbOk) {
        stuck = (await settle(r.createP)) === TIMEOUT;
        if (!stuck) stuck = (await settle(r.flushing)) === TIMEOUT;
        // 残りも断片として書いておく（まとめる前に、音声を全部 DB に入れておく。まとめに失敗しても欠けないように）
        if (!stuck && r.sessionId != null && r.chunks.length) stuck = (await settle(flushAudio(r))) === TIMEOUT;
    }

    // 1本の音声にする。断片が読めないとき・DB が返らないときは、欠けた音声を作らない
    let blob = null;
    let complete = true; // blob が録音の全部か
    if (dbOk && !stuck && r.sessionId != null) {
        const v = await settle(db.assembleAudio(r.sessionId, r.chunks, r.mimeType));
        if (v === TIMEOUT || (v && v.error)) {
            complete = false;
            stuck = stuck || v === TIMEOUT;
        } else {
            blob = v;
        }
    } else if (dbOk && r.seq > 0) {
        complete = false; // 断片は書いてあるが、読めない（DB が返らない）
    } else {
        blob = r.chunks.length ? new Blob(r.chunks, { type: r.mimeType || '' }) : null;
    }

    const hasText = !!(s.text && s.text.trim());
    if (complete && !stuck && !(blob && blob.size > 0) && !hasText) {
        if (dbOk && r.sessionId != null) {
            db.deleteSession(r.sessionId).catch(() => {});
            db.deleteSegments(r.sessionId).catch(() => {});
        }
        showToast('録音できていなかったので、記録は残しませんでした');
        finishStop(r, drained, { ghost: true });
        return;
    }

    s.durationSec = Math.round(r.stoppedAtSec);
    s.status = 'done';
    s.updatedAt = Date.now();
    s.audioBlob = null;
    s._segAudio = null;
    s._memAudio = null;
    let memOnly = false; // 音声の一部か全部が、メモリにしか無い
    if (!dbOk) {
        s._memAudio = blob;
        memOnly = !!blob;
    } else if (stuck) {
        onSaveError(new Error('保存の返事がありません'), 'final');
        if (complete && blob) s._memAudio = blob; // 断片を書く前だった＝メモリの分が全部
        memOnly = true;
    } else {
        const patch = { text: s.text, rawText: s.rawText, durationSec: s.durationSec, status: 'done', mimeType: s.mimeType, updatedAt: s.updatedAt };
        if (complete && blob && blob.size > 0) patch.audioBlob = blob;
        const segId = r.sessionId;
        let savedAll = false;
        try {
            let saved = segId != null ? await db.patchSession(segId, patch) : null;
            if (!saved) {
                // 記録が無い（作れていなかった・ほかの画面で消された）：作り直す。断片は元の id のまま、まとめて入れる
                r.sessionId = await db.addSession({ title: s.title, timestamp: s.timestamp, startedAt: s.startedAt, ...patch });
                saved = true;
            }
            s.id = r.sessionId;
            savedAll = true;
            markSaved('final');
        } catch (e) {
            onSaveError(e, 'final');
            // 1本にまとめて入れられない（容量不足など）。断片は全部書いてあるので残し、文字と状態だけ保存する
            if (patch.audioBlob && segId != null) {
                delete patch.audioBlob;
                try { await db.patchSession(segId, patch); } catch (e2) { /* 帯は出ている */ }
            }
        }
        if (savedAll) {
            s.audioBlob = patch.audioBlob || null;
            if (patch.audioBlob && segId != null) db.deleteSegments(segId).catch(() => {}); // まとめ終わってから消す
        } else if (complete && blob) {
            s._segAudio = blob; // 書き出しは、つないだもの（メモリ）で出す。断片は DB に残っている
            memOnly = r.chunks.length > 0;
        }
        if (!complete) showToast('音声をまとめられませんでした。次に開いたときにまとめ直します', 'error');
    }
    if (memOnly) unsavedAudio.add(s);
    r.chunks = [];
    if (STOP_REASON_TOAST[reason]) showToast(STOP_REASON_TOAST[reason], 'error');
    finishStop(r, drained, {});
}

async function finishStop(r, drained, { ghost }) {
    r.ended = true;
    if (r.releaseLock) r.releaseLock();
    rec = null;
    state.phase = 'idle';
    if (ghost && current === r.session) current = null;
    renderSessionHeader();
    prepareExports();
    renderHistory();
    refreshStorageUsage();
    updateUI();
    refreshSrBanner();
    drained.then(() => onDrained(r, ghost));
    if (ghost) return;
    if (state.dbMode !== 'ok') {
        // 保存しないモード：音声を1回ダウンロードしてみる（iPhone ではタップが要るので、［音声］で保存してもらう）
        const a = exportsReady.audio;
        if (a) { try { downloadBlob(a.blob, a.name); } catch (e) { /* ［音声］で保存できる */ } }
        $('storageBannerText').textContent = 'この設定では保存できません。［音声］［文字(.txt)］で手元に保存してください';
        setShown('storageBanner', true);
    }
    const s = r.session;
    const name = await showPrompt({ title: '会議の名前', message: '保存しました。名前を付けられます', defaultValue: s.title, okLabel: '保存', cancelLabel: 'このまま' });
    updateLeaveGuard();
    if (name == null || !name.trim() || name.trim() === s.title) return;
    s.title = name.trim();
    if (state.dbMode === 'ok' && s.id != null) {
        try {
            await db.patchSession(s.id, { title: s.title, updatedAt: Date.now() });
            markSaved('title');
        } catch (e) {
            onSaveError(e, 'title');
        }
    }
    if (current === s) {
        renderSessionHeader();
        prepareExports();
        updateUI();
    }
    renderHistory();
}

// 停止のあとに届いた最後の文を、停止した会議に書き足す（そのとき開いている会議ではない）
function onDrained(r, ghost) {
    draining.delete(r.session);
    if (current === r.session) $('interimDisplay').textContent = '';
    if (!ghost && r.lateAdded && state.dbMode === 'ok' && r.session.id != null) {
        db.patchSession(r.session.id, { text: r.session.text, rawText: r.session.rawText, updatedAt: Date.now() })
            .then(() => markSaved('late'))
            .catch((e) => onSaveError(e, 'late'));
    }
    if (current === r.session) prepareExports();
    updateUI();
}

// ---- 14. 文字起こしの帯・準備・URL のコピー ----
function refreshSrBanner() {
    let b;
    if (state.srStoppedNotice && state.phase === 'recording') b = { text: '文字起こしは止まりました（録音は続いています）', action: null };
    else if (state.srFreshInstall) b = { text: '文字起こしを使うには、Chrome をいったん全部閉じて、開き直してください（準備のあとに1回だけ）', action: null };
    // 始まらないまま続く：Chrome の音声認識は「自動字幕起こし」の言語のデータが無いと動かない（2026-09-27 社長のPCで判明）
    else if (state.srRestartNotice) b = { text: RESTART_HELP, action: null };
    else b = srBannerFor({ availability: state.srAvail, installState: state.srInstall, isMobile: IS_MOBILE, browser: BROWSER });
    const key = b ? b.text : '';
    if (key !== state.srBannerKey) {
        state.srBannerKey = key;
        state.srBannerClosed = false; // 中身が変わったら、閉じていてもまた出す
    }
    const banner = $('srBanner');
    if (!b || state.srBannerClosed || IS_INAPP) {
        banner.hidden = true;
        return;
    }
    $('srBannerText').textContent = b.text;
    const act = $('srBannerAction');
    if (b.action) {
        act.textContent = SR_ACTION_LABELS[b.action];
        act.setAttribute('data-action', b.action);
        act.hidden = false;
    } else {
        act.hidden = true;
    }
    banner.hidden = false;
}

let pollTimer = null;
let availP = null; // 起動時の確認（録音開始がこれを待てるように）
async function refreshAvailability() {
    state.srAvail = await checkAvailability();
    if (state.srAvail === 'available') state.srInstall = null;
    refreshSrBanner();
    updatePlaceholder();
    maybeStartTranscription();
    clearTimeout(pollTimer);
    if (state.srAvail === 'downloading') pollTimer = setTimeout(refreshAvailability, 5000);
}

// 準備（言語データの取得）。タップの中で、await を挟まずに install を呼ぶ
const FRESH_INSTALL_MS = 8000; // 準備にこれ以上かかった＝言語データを取ってきた（開き直すまで動かない）

function doInstall() {
    const startedAt = Date.now();
    const p = installLanguagePack();
    state.srInstall = 'installing';
    refreshSrBanner();
    p.then(async (ok) => {
        state.srAvail = await checkAvailability();
        if (state.srAvail === 'available') {
            state.srInstall = null;
            if (Date.now() - startedAt >= FRESH_INSTALL_MS) {
                state.srFreshInstall = true;
                showToast('準備ができました。Chrome をいったん全部閉じて開き直すと、文字起こしが使えます');
            } else {
                showToast(state.phase === 'recording' ? '文字起こしの準備ができました。ここから文字になります' : '文字起こしの準備ができました');
            }
            maybeStartTranscription();
        } else if (state.srAvail === 'downloading') {
            state.srInstall = null;
            clearTimeout(pollTimer);
            pollTimer = setTimeout(refreshAvailability, 5000);
        } else {
            state.srInstall = 'failed'; // 準備が失敗したか、終わっても使える状態にならなかった
        }
        refreshSrBanner();
        updatePlaceholder();
    });
}

function copyUrl() {
    const url = location.origin + '/';
    const fallback = () => {
        showPrompt({ title: 'このURLを開いてください', message: '長押しでコピーできます', defaultValue: url, okLabel: '閉じる', cancelLabel: null, readOnly: true })
            .then(() => updateLeaveGuard());
    };
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(() => showToast('URLをコピーしました'), fallback);
            return;
        }
    } catch (e) { /* 下の見せる方式へ */ }
    fallback();
}

// ---- 15. メモ ----
function addMemo() {
    const input = $('manualMemoInput');
    const body = input.value;
    if (!body.trim()) return;
    if (rec && state.phase === 'recording') {
        const line = formatMemoLine(state.memoType, secToStamp(elapsedSec(rec)), body);
        if (!line) return;
        rec.session.text += line;
        rec.textDirty = true;
        appendLine(line);
        input.value = '';
        saveText(rec);
        updateLeaveGuard();
        return;
    }
    if (!current || isBusy()) return;
    if (current.status === 'recording') {
        showToast('ほかの画面で録音中の会議には、メモを足せません');
        return;
    }
    const sec = lastStampSec(current.text);
    const line = formatMemoLine(state.memoType, secToStamp(sec == null ? 0 : sec), body);
    if (!line) return;
    // 先にメモリの本文へ足す（停止直後に届く最後の文と、同じ1本の本文に積む＝どちらも消えない）
    const target = current;
    target.text = (target.text || '') + line;
    appendLine(line);
    input.value = '';
    prepareExports();
    updateUI();
    if (state.dbMode !== 'ok' || target.id == null) return;
    // 書くのはそのときの本文の全部（あとから届いた最後の文も含む）。書き込みは作った順に確定する
    db.patchSession(target.id, { text: target.text, updatedAt: Date.now() })
        .then(() => markSaved('memo'))
        .catch((e) => onSaveError(e, 'memo'));
}

// ---- 16. 履歴のドロワー ----
function openSidebar() {
    $('sidebar').classList.add('is-open');
    setShown('sidebarOverlay', true);
    $('toggleSidebarBtn').setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
    $('sidebar').classList.remove('is-open');
    setShown('sidebarOverlay', false);
    $('toggleSidebarBtn').setAttribute('aria-expanded', 'false');
}

// ---- 17. マイクの一覧 ----
async function populateMics() {
    const sel = $('micSelect');
    let devices = [];
    try {
        devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    } catch (e) { /* 一覧が取れなければ既定だけ */ }
    const saved = ls.get('micId') || '';
    sel.textContent = '';
    sel.appendChild(new Option('既定のマイク', ''));
    let n = 0;
    devices.forEach((d) => {
        if (!d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications') return;
        n++;
        sel.appendChild(new Option(d.label || 'マイク' + n, d.deviceId));
    });
    sel.value = Array.prototype.some.call(sel.options, (o) => o.value === saved) ? saved : '';
}

// ---- 18. 操作のつなぎ込み ----
function wireEvents() {
    on('recBtn', 'click', () => {
        if (state.phase === 'recording') stopRecording('user');
        else if (state.phase === 'idle') startFlow();
    });
    on('stopPcAudioBtn', 'click', () => { if (rec) endPcAudio(rec, false); });
    on('downloadTransBtn', 'click', () => {
        const t = exportsReady.txt;
        if (t && !(current && draining.has(current))) saveFile(t.blob, t.name, null, IS_MOBILE); // タップの中で同期で（iPhone のため）
    });
    on('downloadAudioBtn', 'click', () => {
        const a = exportsReady.audio;
        if (!a) return;
        const target = current;
        saveFile(a.blob, a.name, () => {
            if (target && unsavedAudio.delete(target)) updateLeaveGuard(); // 手元に保存したので、閉じるときの警告を外す
        }, IS_MOBILE);
    });
    on('newSessionBtn', 'click', () => {
        if (isBusy()) return;
        current = null;
        renderSession();
        prepareExports();
        renderHistory();
    });
    on('sourceGroup', 'click', (e) => {
        const b = e.target.closest('.source-btn');
        if (!b || isBusy()) return;
        state.source = b.getAttribute('data-source') === 'mix' ? 'mix' : 'mic';
        ls.set('source', state.source);
        updateUI();
    });
    on('memoTypeGroup', 'click', (e) => {
        const b = e.target.closest('.memo-type-btn');
        if (!b) return;
        state.memoType = b.getAttribute('data-memo-type') || 'memo';
        updateUI();
    });
    on('addMemoBtn', 'click', addMemo);
    on('manualMemoInput', 'keydown', (e) => {
        if (e.key === 'Enter' && !isImeEnter(e)) {
            e.preventDefault();
            addMemo();
        }
    });
    on('manualMemoInput', 'input', updateLeaveGuard);
    on('micSelect', 'change', () => ls.set('micId', $('micSelect').value));
    on('fillerToggle', 'click', () => {
        state.fillerOn = !state.fillerOn;
        ls.set('filler', state.fillerOn ? 'on' : 'off');
        $('fillerToggle').setAttribute('aria-checked', String(state.fillerOn));
    });
    on('historyList', 'click', (e) => {
        const btn = e.target.closest('button[data-id]');
        if (!btn || btn.disabled) return;
        const id = Number(btn.getAttribute('data-id'));
        if (btn.classList.contains('history-open')) openSession(id);
        else if (btn.classList.contains('history-rename')) renameSession(id);
        else if (btn.classList.contains('history-delete')) deleteSessionFlow(id);
    });
    on('toggleSidebarBtn', 'click', () => {
        if ($('sidebar').classList.contains('is-open')) closeSidebar();
        else openSidebar();
    });
    on('closeSidebarBtn', 'click', closeSidebar);
    on('sidebarOverlay', 'click', closeSidebar);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !isDialogOpen()) closeSidebar();
    });
    on('srBannerAction', 'click', () => {
        const a = $('srBannerAction').getAttribute('data-action');
        if (a === 'copyUrl') copyUrl();
        else if (a === 'install' || a === 'retry') doInstall();
    });
    on('srBannerCloseBtn', 'click', () => {
        state.srBannerClosed = true;
        setShown('srBanner', false);
    });
    on('storageBannerCloseBtn', 'click', () => setShown('storageBanner', false));
    on('saveErrorCloseBtn', 'click', () => setShown('saveErrorBanner', false));

    // 画面が隠れる・閉じられるときは、その場で文字と音声を保存する。戻ったら画面の点灯を取り直す
    document.addEventListener('visibilitychange', () => {
        if (!rec || state.phase !== 'recording') return;
        if (document.hidden) {
            saveText(rec, true);
            flushAudio(rec);
        } else {
            requestWakeLock();
        }
    });
    window.addEventListener('pagehide', () => {
        if (!rec || state.phase !== 'recording') return;
        saveText(rec, true);
        flushAudio(rec);
    });
    // 名前の入力が開いているあいだも、閉じるときの警告を付ける
    if ('MutationObserver' in window) {
        new MutationObserver(updateLeaveGuard).observe($('promptModal'), { attributes: true, attributeFilter: ['hidden'] });
    }
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', () => { if (!isBusy()) populateMics(); });
    }
}

// ---- 19. 起動 ----
async function init() {
    // アプリの中のブラウザ：ここで止める。録音・保存・文字起こしの確認・マイクの一覧・Service Worker などは、
    // LINE WORKS などの中で呼ぶと落ちることがあるので、1つも呼ばない（案内の画面は inapp.js が出す）
    if (IS_INAPP) {
        if (!window.__QB_INAPP) { // inapp.js が読めなかった：画面だけ切り替える（URL 欄は長押しでコピーできる）
            document.documentElement.classList.add('is-inapp');
            const s = $('inappScreen');
            if (s) s.hidden = false;
        }
        return;
    }
    const topBar = $('topBar');
    const setTopH = () => document.documentElement.style.setProperty('--topbar-h', topBar.offsetHeight + 'px');
    setTopH();
    if ('ResizeObserver' in window) new ResizeObserver(setTopH).observe(topBar);
    renderIcons();
    $('appVersion').textContent = 'v' + APP_VERSION;
    setShown('exportNoteIos', IS_IOS);
    setShown('sourceGroup', CAN_PC);
    state.source = CAN_PC && ls.get('source') === 'mix' ? 'mix' : 'mic';
    state.fillerOn = ls.get('filler') !== 'off';
    $('fillerToggle').setAttribute('aria-checked', String(state.fillerOn));
    availP = refreshAvailability(); // 文字起こしが使えるかは、最初に確かめ始める（DB の後始末を待たない）
    wireEvents();
    renderSession();
    prepareExports();
    updateUI();

    try {
        await db.openMainDb();
    } catch (e) {
        console.error('保存の場所を開けませんでした', e);
        state.dbMode = 'none';
        $('storageBannerText').textContent = 'この設定では保存できません';
        setShown('storageBanner', true);
    }
    if (state.dbMode === 'ok') {
        const r = await recoverStaleSessions();
        if (r.interrupted > 0) showToast('前回の録音が途中で止まっていました。履歴の「中断」から開けます');
        if (r.skipped > 0) setTimeout(() => { if (!isBusy()) recoverStaleSessions().then((x) => { if (x.interrupted) renderHistory(); }); }, RECOVER_AGAIN_MS);
    }
    await renderHistory();
    refreshStorageUsage();
    populateMics();

    // 更新のお知らせは、前から使っている人（記録が1件以上ある人）にだけ
    if (state.dbMode === 'ok') {
        try {
            const count = (await db.getAllSessions()).length;
            const seen = ls.get('seenVersion');
            if (shouldShowUpdateToast({ sessionCount: count, seenVersion: seen, currentVersion: APP_VERSION })) {
                showToast('v4.0 に更新しました。文字起こしは Chrome で動きます');
            }
        } catch (e) { /* お知らせは出せなくてよい */ }
    }
    ls.set('seenVersion', APP_VERSION);

    // SW は本番だけ。更新しても自分で再読み込みはしない（録音中に画面が切り替わらないように）
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW を登録できませんでした', e));
    }
}

init();
