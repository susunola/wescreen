// Shared persistence API. All sessions are independent; archive never replaces a saved video.
const DB_VERSION = 4;
const db = new Promise((resolve, reject) => {
  const request = indexedDB.open('wescreen', DB_VERSION);
  let settled = false;
  const fail = error => { if (!settled) { settled = true; reject(error); } };
  request.onupgradeneeded = () => {
    const database = request.result;
    for (const name of ['chunks', 'videos', 'meta']) if (!database.objectStoreNames.contains(name)) database.createObjectStore(name);
    for (const name of ['recordings', 'tasks']) if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'id' });
  };
  request.onblocked = () => fail(new Error('Database upgrade blocked. Close other WeScreen pages and reload. / 请关闭其他 WeScreen 页面并刷新。'));
  request.onerror = () => fail(request.error);
  request.onsuccess = () => {
    if (settled) { request.result.close(); return; }
    settled = true;
    request.result.onversionchange = () => { request.result.close(); window.dispatchEvent(new Event('wescreen-storage-closed')); };
    resolve(request.result);
  };
});
// Handle early open errors until boot can display them; callers still receive the rejection.
db.catch(() => {});
const runTx = (names, mode, run) => db.then(database => new Promise((resolve, reject) => {
  const tx = database.transaction(names, mode);
  tx.oncomplete = () => resolve(true);
  tx.onerror = tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
  try { run(tx); } catch (error) { tx.abort(); reject(error); }
}));
const pendingWrites = new Set();
const track = promise => { pendingWrites.add(promise); promise.catch(() => {}).finally(() => pendingWrites.delete(promise)); return promise; };
const chunkRange = session => IDBKeyRange.bound(`${session}-`, `${session}-\uffff`);
const readStore = (store, key) => db.then(database => new Promise((resolve, reject) => {
  const request = key === undefined ? database.transaction(store).objectStore(store).getAll() : database.transaction(store).objectStore(store).get(key);
  request.onsuccess = () => {
    const value = request.result;
    if (store === 'videos' && value?.diskBacked) {
      value.diskHandle.getFile().then(file => {
        if (file.size !== value.size) throw new Error('Recording file changed. / 录像文件已变化，请重新关联原文件。');
        resolve(file);
      }).catch(error => reject(new Error('Cannot read recording file; keep the selected folder available. / 无法读取录像，请保留所选目录并重新授权。 ' + error.message)));
    } else resolve(value);
  };
  request.onerror = () => reject(request.error);
}));
const saveChunk = (blob, session, seq) => track(runTx('chunks', 'readwrite', tx => tx.objectStore('chunks').put(blob, `${session}-${String(seq).padStart(6, '0')}`)));
const loadChunks = session => db.then(database => new Promise((resolve, reject) => {
  const request = database.transaction('chunks').objectStore('chunks').getAll(session ? chunkRange(session) : undefined);
  request.onsuccess = () => resolve(request.result || []); request.onerror = () => reject(request.error);
}));
const clearSessionChunks = session => runTx('chunks', 'readwrite', tx => tx.objectStore('chunks').delete(chunkRange(session)));
const readInProgress = () => readStore('meta', 'inProgress');
const latestChunkSession = () => db.then(database => new Promise((resolve, reject) => {
  const request = database.transaction('chunks').objectStore('chunks').openKeyCursor(null, 'prev');
  request.onsuccess = () => resolve(request.result ? String(request.result.key).replace(/-\d{6}$/, '') : null); request.onerror = () => reject(request.error);
}));
const setInProgress = value => track(runTx('meta', 'readwrite', tx => {
  const meta = tx.objectStore('meta');
  meta.put(value, 'inProgress');
  if (value?.session) meta.put(value, `session:${value.session}`);
}));
async function pendingSessions() {
  const database = await db;
  const sessions = await new Promise((resolve, reject) => {
    const request = database.transaction('meta').objectStore('meta').getAll(IDBKeyRange.bound('session:', 'session:\uffff'));
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  let legacy = await readInProgress();
  if (legacy === true) legacy = { session: await latestChunkSession(), name: 'recovered-recording.webm' };
  if (legacy?.session && !sessions.some(item => item.session === legacy.session)) sessions.push(legacy);
  return sessions;
}
async function discardSession(session) {
  await runTx(['chunks', 'meta'], 'readwrite', tx => {
    tx.objectStore('chunks').delete(chunkRange(session));
    const meta = tx.objectStore('meta'); meta.delete(`session:${session}`);
    const current = meta.get('inProgress');
    current.onsuccess = () => { if (current.result === true || current.result?.session === session) meta.put(false, 'inProgress'); };
  });
}
function storageError() { storageFailure = true; setHint('storageFailed', [], true); }
async function recordingDecodes(blob) {
  if (!blob.type.startsWith('video/')) return true;
  const video=document.createElement('video'),url=URL.createObjectURL(blob);video.preload='auto';video.muted=true;
  try { return await new Promise(resolve=>{const done=value=>{clearTimeout(timer);video.onloadeddata=video.onerror=null;resolve(value);};const timer=setTimeout(()=>done(false),10000);video.onloadeddata=()=>done(video.videoWidth>0&&video.videoHeight>0);video.onerror=()=>done(false);video.src=url;video.load();}); }
  finally { video.removeAttribute('src');video.load();URL.revokeObjectURL(url); }
}
async function archiveRecording(blob, name, session = sessionStartedAt, part = segmentIndex, recovered = false, details = {}) {
  if (!blob.size) return;
  const id = `${session}-${part}`;
  const course = recovered ? details.course || '' : ($('course-enabled').checked ? $('course-name').value.trim() : '');
  const entry = { id, name, course, size: blob.size, createdAt: Date.now(), duration: recovered ? details.duration || 0 : finalDuration, markers: recovered ? details.markers || [] : finalMarkers.map(marker => ({ ...marker })), ...details };
  // Only replace the recovery copy after the external file is closed and verified.
  let storedVideo = blob;
  if (details.diskStorage === 'file' && details.diskHandle) {
    try {
      const file = await details.diskHandle.getFile();
      if (file.size !== blob.size) throw new Error('Incomplete disk recording');
      if (!await recordingDecodes(file)) throw new Error('Disk recording cannot be decoded');
      storedVideo = { diskBacked: true, diskHandle: details.diskHandle, size: file.size };
      entry.storageKind = 'disk';
    } catch { entry.storageKind = 'browser';entry.diskVerificationFailed=true;if(typeof recordDiagnostic==='function')recordDiagnostic('disk-verification-failed');if(typeof setNotice==='function')setNotice(E('磁盘校验或解码未通过，已保留录像库副本。','Disk verification or decoding failed; a full library copy was retained.')); }
  }
  await runTx(['recordings', 'videos', 'chunks', 'meta'], 'readwrite', tx => {
    tx.objectStore('recordings').add(entry); // ConstraintError is safer than overwriting a completed recording.
    tx.objectStore('videos').add(storedVideo, id);
    tx.objectStore('chunks').delete(chunkRange(session));
    const meta = tx.objectStore('meta'); meta.delete(`session:${session}`);
    const current = meta.get('inProgress');
    current.onsuccess = () => { if (current.result === true || current.result?.session === session) meta.put(false, 'inProgress'); };
  });
  renderRecordingLibrary().catch(error => { $('library-status').textContent = error.message; });
  saveThumbnail(blob, id).catch(() => {});
  return id;
}
