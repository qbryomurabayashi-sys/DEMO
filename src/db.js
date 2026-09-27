// 保存（IndexedDB）
// - 会議の記録：LocalAIAssistantDB（version 3）の sessions。名前・version・既存の4項目（title, text, audioBlob, timestamp）は変えない。
//   足した項目：status, rawText, startedAt, durationSec, mimeType, updatedAt（無い旧レコードでも動くこと）。
// - 録音途中の音声：LocalAIAssistantAudio（version 1）の segments に、30秒分ずつ足していく。
//   停止したら sessions の audioBlob に1本にまとめてから、segments を消す。
//   sessions の DB に store を足すと version が上がり、前の版に戻したときに開けなくなるので、別の DB にしている。
// 画面のことは知らない（文言やトーストは app.js）。

const MAIN = { name: 'LocalAIAssistantDB', version: 3, store: 'sessions' };
const AUDIO = { name: 'LocalAIAssistantAudio', version: 1, store: 'segments' };

let mainDb = null;
let audioDb = null;

export function isQuotaError(err) {
    return !!err && (err.name === 'QuotaExceededError' || err.code === 22);
}

function openRaw(spec, upgrade, onClosed) {
    return new Promise((resolve, reject) => {
        let req;
        try {
            req = indexedDB.open(spec.name, spec.version);
        } catch (e) {
            reject(e); // SecurityError（サイトデータのブロック）など
            return;
        }
        req.onupgradeneeded = () => upgrade(req.result);
        req.onsuccess = () => {
            const db = req.result;
            // 別のタブが version を上げようとしたら閉じて譲る（この版は上げない）
            db.onversionchange = () => {
                try { db.close(); } catch (e) { /* 閉じられなくても次に開き直す */ }
                onClosed();
            };
            db.onclose = onClosed;
            resolve(db);
        };
        req.onerror = () => reject(req.error);
    });
}

export async function openMainDb() {
    mainDb = await openRaw(MAIN, (db) => {
        if (!db.objectStoreNames.contains(MAIN.store)) {
            db.createObjectStore(MAIN.store, { keyPath: 'id', autoIncrement: true });
        }
    }, () => { mainDb = null; });
    return mainDb;
}

async function openAudioDb() {
    audioDb = await openRaw(AUDIO, (db) => {
        if (!db.objectStoreNames.contains(AUDIO.store)) {
            const s = db.createObjectStore(AUDIO.store, { keyPath: 'id', autoIncrement: true });
            s.createIndex('sessionId', 'sessionId', { unique: false });
        }
    }, () => { audioDb = null; });
    return audioDb;
}

// 1つのトランザクションで fn(store, setResult) を行い、書き込みが終わった（oncomplete）ときに結果を返す
function runTx(db, storeName, mode, fn) {
    return new Promise((resolve, reject) => {
        let t;
        try {
            t = db.transaction(storeName, mode);
        } catch (e) {
            reject(e);
            return;
        }
        let result;
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('transaction aborted'));
        try {
            fn(t.objectStore(storeName), (v) => { result = v; });
        } catch (e) {
            try { t.abort(); } catch (e2) { /* すでに終わっている */ }
            reject(e);
        }
    });
}

// 失敗したら DB を開き直して1回だけやり直す（容量不足はやり直さない）
async function withMain(fn) {
    if (!mainDb) await openMainDb();
    try {
        return await fn(mainDb);
    } catch (e) {
        if (isQuotaError(e)) throw e;
        mainDb = null;
        await openMainDb();
        return fn(mainDb);
    }
}

async function withAudio(fn) {
    if (!audioDb) await openAudioDb();
    try {
        return await fn(audioDb);
    } catch (e) {
        if (isQuotaError(e)) throw e;
        audioDb = null;
        await openAudioDb();
        return fn(audioDb);
    }
}

// ---- 会議の記録（sessions） ----

export function getAllSessions() {
    return withMain((db) => runTx(db, MAIN.store, 'readonly', (store, set) => {
        store.getAll().onsuccess = (e) => set(e.target.result || []);
    }));
}

export function getSession(id) {
    return withMain((db) => runTx(db, MAIN.store, 'readonly', (store, set) => {
        store.get(id).onsuccess = (e) => set(e.target.result || null);
    }));
}

// → 新しい id
export function addSession(rec) {
    return withMain((db) => runTx(db, MAIN.store, 'readwrite', (store, set) => {
        store.add(rec).onsuccess = (e) => set(e.target.result);
    }));
}

// 1件の一部だけを書き換える（読む → 渡した項目だけ上書き → 書く、を1つのトランザクションで。知らない項目は消さない）。
// 値が undefined の項目は消す。→ 書き換えた後の1件。その id が無ければ null（何も書かない）
export function patchSession(id, patch) {
    return withMain((db) => runTx(db, MAIN.store, 'readwrite', (store, set) => {
        store.get(id).onsuccess = (e) => {
            const rec = e.target.result;
            if (!rec) { set(null); return; }
            Object.keys(patch).forEach((k) => {
                if (patch[k] === undefined) delete rec[k];
                else rec[k] = patch[k];
            });
            store.put(rec);
            set(rec);
        };
    }));
}

export function deleteSession(id) {
    return withMain((db) => runTx(db, MAIN.store, 'readwrite', (store) => { store.delete(id); }));
}

// ---- 録音途中の音声（segments） ----

// seg = { sessionId, seq, blob, bytes, createdAt }
export function addSegment(seg) {
    return withAudio((db) => runTx(db, AUDIO.store, 'readwrite', (store, set) => {
        store.add(seg).onsuccess = (e) => set(e.target.result);
    }));
}

// その会議の断片を seq の順に → [{ seq, blob }]
export function getSegments(sessionId) {
    return withAudio((db) => runTx(db, AUDIO.store, 'readonly', (store, set) => {
        store.index('sessionId').getAll(sessionId).onsuccess = (e) => {
            const list = (e.target.result || []).slice().sort((a, b) => a.seq - b.seq);
            set(list.map((s) => ({ seq: s.seq, blob: s.blob })));
        };
    }));
}

export function deleteSegments(sessionId) {
    return withAudio((db) => runTx(db, AUDIO.store, 'readwrite', (store, set) => {
        let n = 0;
        store.index('sessionId').openKeyCursor(IDBKeyRange.only(sessionId)).onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) { set(n); return; }
            store.delete(cursor.primaryKey);
            n++;
            cursor.continue();
        };
    }));
}

// 断片を持っている会議の id の一覧
export function segmentSessionIds() {
    return withAudio((db) => runTx(db, AUDIO.store, 'readonly', (store, set) => {
        const ids = [];
        store.index('sessionId').openKeyCursor(null, 'nextunique').onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) { set(ids); return; }
            ids.push(cursor.key);
            cursor.continue();
        };
    }));
}

// 断片（と、まだ書いていない残り）を1本の音声にする。断片が1つも無く残りも無ければ null
export async function assembleAudio(sessionId, tailChunks, type) {
    const segs = sessionId == null ? [] : await getSegments(sessionId);
    const parts = segs.map((s) => s.blob).concat(tailChunks || []);
    if (!parts.length) return null;
    return new Blob(parts, { type: type || (parts[0] && parts[0].type) || '' });
}
