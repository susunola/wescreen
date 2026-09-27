const $ = (id) => document.querySelector(`#${id}`);

const BITRATES = { compact: 2500000, standard: 6000000, high: 11000000 };
const AUDIO_BITRATE = 128000;
const TIMESLICE_MS = 1000;
// The whole recording is assembled in the tab heap at stop time, so the recorded payload —
// not the wall-clock length — is what decides whether the tab survives.
const HEAP_WARN_BYTES = 800 * 1024 * 1024;
const HEAP_LIMIT_BYTES = 1600 * 1024 * 1024;
const STORAGE_FLOOR_BYTES = 500 * 1024 * 1024;
const OPEN_QUALITIES = new Set(['source', '1080', '720']);

const I18N = {
  zh: {
    langSwitch: 'English', pageTitle: 'WeScreen',
    eyebrow: '本地处理 · 保护隐私 · 为 EDGE 打造',
    privacy: '无账号 · 无上传 · 无追踪 —— 录制、混音和存储全部在这台设备上完成。',
    setupLead: '录制整个屏幕、窗口或标签页。所有媒体只在你的设备上处理。',
    labelFilename: '文件名', labelResolution: '分辨率', labelQuality: '画质', labelFrameRate: '帧率', labelCountdown: '倒计时', labelAutoStop: '自动停止',
    resSource: '原始分辨率', res1080: '1080p', res720: '720p',
    qualityStandard: '标准', qualityHigh: '高画质', qualityCompact: '节省空间',
    countdownNone: '不等待', countdown3: '3 秒', countdown5: '5 秒',
    autostopNone: '不设置', autostop5: '5 分钟', autostop15: '15 分钟', autostop30: '30 分钟',
    legendSources: '音视频源', toggleScreenAudio: '系统 / 标签页音频', toggleMicrophone: '麦克风旁白', toggleCamera: '摄像头画中画',
    btnStart: '开始录制', btnPause: '暂停', btnResume: '继续', btnStop: '停止录制', btnDownload: '下载 WebM', btnNewRecording: '新建录制',
    btnRecover: '恢复并下载', btnDiscard: '丢弃',
    shortcutHint: '录制中可按 Ctrl/⌘ + Shift + S 停止；Ctrl/⌘ + Shift + U 暂停或继续。',
    recordingHint: '录制片段会暂存到本机，以便意外关闭后恢复。',
    resultTitle: '录制完成',
    storageHint: (free) => `本机可用存储约 ${free}，录像只写入这台设备。`,
    storageUnknown: '无法读取本机可用存储空间。',
    starting: (n) => `${n}…`,
    memory: (used, limit) => `已录制约 ${used}（本次上限约 ${limit}）`,
    heapWarn: (used) => `录像已达 ${used}，请尽快停止并下载，以免浏览器内存不足。`,
    heapCritical: (used) => `录像已达 ${used}，接近浏览器内存上限，现在停止以保住这段录像。`,
    lowDisk: (free) => `本机可用存储只剩 ${free}，请先清理磁盘再录制长视频。`,
    resultSize: (size) => `文件大小约 ${size}。`,
    recoveryFound: (size) => `检测到未完成的本地录制（约 ${size}）。`,
    degradedMic: '麦克风不可用，已继续录制画面与系统声音。',
    degradedSurfaces: '麦克风与系统声音都不可用，本次只录画面。',
    degradedScreenAudio: '当前共享源没有音频，本次只录画面。',
    scaledDown: (res) => `已按 ${res} 缩放输出。`,
    keepsSource: (res) => `源分辨率 ${res} 未超过所选上限，保持原始画面。`,
    errPickerCanceled: '已取消屏幕选择。',
    errNoSource: '没有找到可录制的画面源。',
    errSourceEnded: '共享的屏幕或窗口已被关闭，录制已停止。',
    errRecorder: '录制过程中浏览器报告了错误，已停止录制。',
    errUnsupported: '当前浏览器不支持 WebM 录制。',
    errStart: (msg) => `无法开始录制：${msg}`,
    errEmpty: '没有可下载的录像数据。',
    errDownload: '保存文件失败，请检查浏览器的下载设置。'
  },
  en: {
    langSwitch: '中文', pageTitle: 'WeScreen',
    eyebrow: 'LOCAL · PRIVATE · EDGE',
    privacy: 'No account · No upload · No tracking — recording, mixing, and storage all happen on this device.',
    setupLead: 'Record your entire screen, a window, or a tab. All media is processed on your device only.',
    labelFilename: 'File name', labelResolution: 'Resolution', labelQuality: 'Quality', labelFrameRate: 'Frame rate', labelCountdown: 'Countdown', labelAutoStop: 'Auto stop',
    resSource: 'Source resolution', res1080: '1080p', res720: '720p',
    qualityStandard: 'Standard', qualityHigh: 'High', qualityCompact: 'Space saver',
    countdownNone: 'No wait', countdown3: '3 seconds', countdown5: '5 seconds',
    autostopNone: 'Off', autostop5: '5 minutes', autostop15: '15 minutes', autostop30: '30 minutes',
    legendSources: 'Audio and video sources', toggleScreenAudio: 'System / tab audio', toggleMicrophone: 'Microphone narration', toggleCamera: 'Camera picture-in-picture',
    btnStart: 'Start recording', btnPause: 'Pause', btnResume: 'Resume', btnStop: 'Stop recording', btnDownload: 'Download WebM', btnNewRecording: 'New recording',
    btnRecover: 'Recover and download', btnDiscard: 'Discard',
    shortcutHint: 'While recording: Ctrl/⌘ + Shift + S stops, Ctrl/⌘ + Shift + U pauses or resumes.',
    recordingHint: 'Chunks are written to this device so an accidental close can be recovered.',
    resultTitle: 'Recording complete',
    storageHint: (free) => `About ${free} of local storage available. This recording is written to this device only.`,
    storageUnknown: 'Local storage availability could not be read.',
    starting: (n) => `${n}…`,
    memory: (used, limit) => `About ${used} recorded (soft limit ${limit})`,
    heapWarn: (used) => `${used} recorded — stop and download soon to avoid running the browser out of memory.`,
    heapCritical: (used) => `${used} recorded — close to the browser memory ceiling. Stop now to keep this recording.`,
    lowDisk: (free) => `Only ${free} of local storage left. Free up disk space before a long recording.`,
    resultSize: (size) => `File size about ${size}.`,
    recoveryFound: (size) => `An unfinished local recording was found (about ${size}).`,
    degradedMic: 'Microphone unavailable — continuing with screen video and system audio.',
    degradedSurfaces: 'Microphone and system audio were both unavailable — video only.',
    degradedScreenAudio: 'The shared source has no audio — recording video only.',
    scaledDown: (res) => `Output scaled to ${res}.`,
    keepsSource: (res) => `Source ${res} fits the selected cap, so the original frame is kept.`,
    errPickerCanceled: 'Screen selection was cancelled.',
    errNoSource: 'No capturable screen source was found.',
    errSourceEnded: 'The shared screen or window was closed, so recording stopped.',
    errRecorder: 'The browser reported an error while recording, so recording stopped.',
    errUnsupported: 'This browser does not support WebM recording.',
    errStart: (msg) => `Could not start recording: ${msg}`,
    errEmpty: 'There is no recorded data to download.',
    errDownload: 'Saving the file failed. Check your browser download settings.'
  }
};
let LANG = 'zh';
const L = (key, ...args) => {
  const value = I18N[LANG][key];
  return typeof value === 'function' ? value(...args) : value;
};

let displayStream = null, micStream = null, cameraStream = null, mixer = null, recorder = null, chunks = [], chunkBytes = 0, compositor = null;
let startedAt = 0, pausedAt = 0, pausedTotal = 0, timer = null, stopTimer = null, finalBlob = null, finalSize = 0;
let sessionStartedAt = 0, lastMemorySync = 0, chunkSeq = 0;
let hintKey = null, hintArgs = [], hintAlerts = false, captureNote = null;
const pendingWrites = new Set();

const pad = (value) => String(value).padStart(2, '0');
const fmt = (ms) => `${pad(Math.floor(Math.floor(ms / 1000) / 60))}:${pad(Math.floor(ms / 1000) % 60)}`;
const elapsed = () => Date.now() - startedAt - pausedTotal - (pausedAt ? Date.now() - pausedAt : 0);

// ---- local chunk store ----------------------------------------------------
const db = new Promise((resolve, reject) => {
  const request = indexedDB.open('wescreen', 2);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains('chunks')) database.createObjectStore('chunks');
    if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta');
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const runTx = (names, mode, run) => db.then((database) => new Promise((resolve, reject) => {
  const tx = database.transaction(names, mode);
  run(tx);
  tx.oncomplete = () => resolve(true);
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
}));
const track = (promise) => { pendingWrites.add(promise); promise.catch(() => {}).finally(() => pendingWrites.delete(promise)); return promise; };
// Chunks are stored as plain Blobs: no encode step, no extra copy in the tab heap.
const saveChunk = (blob, session, seq) => track(runTx('chunks', 'readwrite', (tx) => tx.objectStore('chunks').put(blob, `${session}-${String(seq).padStart(6, '0')}`)));
const clearChunks = () => track(runTx('chunks', 'readwrite', (tx) => tx.objectStore('chunks').clear()));
const setInProgress = (value) => track(runTx('meta', 'readwrite', (tx) => tx.objectStore('meta').put(value, 'inProgress')));
const readInProgress = () => db.then((database) => new Promise((resolve, reject) => {
  const request = database.transaction('meta').objectStore('meta').get('inProgress');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
}));
const loadChunks = () => db.then((database) => new Promise((resolve, reject) => {
  const request = database.transaction('chunks').objectStore('chunks').getAll();
  request.onsuccess = () => resolve(request.result || []);
  request.onerror = () => reject(request.error);
}));

// ---- view helpers ---------------------------------------------------------
function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / (1024 ** power);
  return `${power === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[power]}`;
}
function show(name) { ['setup', 'recording', 'result'].forEach((id) => $(id).classList.toggle('hidden', id !== name)); }
const isRecording = () => !$('recording').classList.contains('hidden');
function sanitized() { return $('filename').value.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\.webm$/i, '') || 'wescreen-recording'; }
function setNotice(message) { const notice = $('notice'); notice.textContent = message || ''; notice.hidden = !message; }
function setHint(key, args = [], alerts = false) {
  hintKey = key;
  hintArgs = args;
  hintAlerts = alerts;
  $('recording-hint').textContent = key ? L(key, ...args) : '';
  $('recording-hint').classList.toggle('alert', Boolean(key) && alerts);
}
// Keeps the resolution notice as a key so it survives a language switch.
function setCaptureNote(key, args = []) {
  captureNote = key ? { key, args } : null;
  if (captureNote) setHint(captureNote.key, captureNote.args);
}

function renderStorageHint() {
  if (!navigator.storage || !navigator.storage.estimate) { $('storage-hint').textContent = L('storageUnknown'); return; }
  navigator.storage.estimate().then(({ quota = 0, usage = 0 }) => {
    const free = Math.max(0, quota - usage);
    $('storage-hint').textContent = free < STORAGE_FLOOR_BYTES ? L('lowDisk', fmtBytes(free)) : L('storageHint', fmtBytes(free));
  }).catch(() => { $('storage-hint').textContent = L('storageUnknown'); });
}
function syncMemory() {
  const memory = $('memory');
  if (!isRecording()) { memory.textContent = ''; memory.className = ''; return; }
  memory.textContent = L('memory', fmtBytes(chunkBytes), fmtBytes(HEAP_LIMIT_BYTES));
  memory.className = `mem${chunkBytes >= HEAP_LIMIT_BYTES ? ' crit' : chunkBytes >= HEAP_WARN_BYTES ? ' warn' : ''}`;
}
function applyLang(next) {
  LANG = I18N[next] ? next : 'zh';
  document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
  document.title = L('pageTitle');
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const value = I18N[LANG][node.dataset.i18n];
    if (typeof value === 'string') node.textContent = value;
  });
  $('privacy').textContent = L('privacy');
  const pauseKey = recorder && recorder.state === 'paused' ? 'btnResume' : 'btnPause';
  $('pause').textContent = L(pauseKey);
  $('pause').dataset.i18n = pauseKey;
  if (!$('start').disabled) {
    const key = isRecording() ? 'btnStop' : 'btnStart';
    $('start').textContent = L(key);
    $('start').dataset.i18n = key;
  }
  if (hintKey) setHint(hintKey, hintArgs, hintAlerts);
  if (finalSize && !$('result').classList.contains('hidden')) setHint('resultSize', [fmtBytes(finalSize)]);
  syncMemory();
  renderStorageHint();
}

// ---- settings -------------------------------------------------------------
const SETTING_FIELDS = [
  ['filename', 'text'], ['resolution', 'select'], ['quality', 'select'], ['framerate', 'select'],
  ['countdown', 'select'], ['autostop', 'select'], ['screen-audio', 'checked'], ['microphone', 'checked'], ['camera', 'checked']
];
const readSettings = () => Object.fromEntries(SETTING_FIELDS.map(([id, kind]) => [id, kind === 'checked' ? $(id).checked : $(id).value]));
const persist = () => chrome.storage.local.set({ settings: readSettings() }).catch(() => {});
async function loadSettings() {
  const { settings = {}, lang, pendingLink, filenameSuggestion } = await chrome.storage.local.get(['settings', 'lang', 'pendingLink', 'filenameSuggestion']);
  if (settings.quality === '1' || settings.quality === '0') settings.quality = 'standard';
  // 1.0 folded resolution into the quality preset; 1.1 gives it its own field.
  if (!OPEN_QUALITIES.has(settings.resolution)) settings.resolution = settings.quality === 'compact' ? '720' : '1080';
  if (lang && I18N[lang]) LANG = lang;
  else if (!String(navigator.language || '').startsWith('zh')) LANG = 'en';
  for (const [id, kind] of SETTING_FIELDS) {
    const value = settings[id];
    if (!$(id) || value === undefined || value === null || value === '') continue;
    if (kind === 'checked') $(id).checked = Boolean(value);
    else if (kind === 'select' && ![...$(id).options].some((option) => option.value === String(value))) continue;
    else $(id).value = String(value);
  }
  if (pendingLink && filenameSuggestion && (!settings.filename || settings.filename === 'wescreen-recording')) {
    $('filename').value = `${filenameSuggestion}-recording`;
    setNotice(LANG === 'zh' ? `已打开 ${new URL(pendingLink).hostname}。在 Edge 选择器中选择该标签页即可开始录制。` : `${new URL(pendingLink).hostname} is ready. Select that tab in the Edge picker to record it.`);
  }
  if (!Number.isFinite(Number($('countdown').value))) $('countdown').value = '3';
}

// ---- capture --------------------------------------------------------------
function mediaType() { return ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type)); }
function captureError(error) {
  if (error && (error.name === 'NotAllowedError' || error.name === 'AbortError')) return L('errPickerCanceled');
  if (error && error.name === 'NotFoundError') return L('errNoSource');
  return error && error.message ? L('errStart', error.message) : L('errStart', 'unknown error');
}
// Downscales the captured track. A rejected constraint only loses the resolution cap, never the take.
async function applyOutputSize(stream) {
  const track = stream.getVideoTracks()[0];
  const resolution = $('resolution').value;
  const frameRate = Number($('framerate').value) || 30;
  const sizeOf = (settings) => (settings.width && settings.height ? `${settings.width}×${settings.height}` : '');
  // getSettings() reports the post-constraint size, so the pre-constraint read is the only
  // way to tell the user whether the output was actually scaled.
  const before = track ? sizeOf(track.getSettings()) : '';
  if (track && track.applyConstraints) {
    const constraints = { frameRate: { ideal: frameRate } };
    if (resolution !== 'source') {
      const height = Number(resolution);
      constraints.height = { max: height };
      constraints.width = { max: Math.round(height * 16 / 9) };
    }
    try { await track.applyConstraints(constraints); } catch { /* keep the source track settings */ }
  }
  const settings = track ? track.getSettings() : {};
  const after = sizeOf(settings);
  if (resolution === 'source' || !after) return null;
  const beforeHeight = before ? Number(before.split('×')[1]) || 0 : 0;
  const afterHeight = Math.round(settings.height || 0);
  const scaled = (beforeHeight && afterHeight && afterHeight < beforeHeight) || (!beforeHeight && afterHeight <= Number(resolution) + 2);
  return { key: scaled ? 'scaledDown' : 'keepsSource', args: [after] };
}
// Missing audio is a degraded take, not a failure: recording always goes ahead.
async function addMic() {
  if (!$('microphone').checked) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch { micStream = null; }
}
async function addCamera() {
  if (!$('camera').checked) return;
  cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
}
async function composePictureInPicture() {
  const screenVideo = document.createElement('video');
  const cameraVideo = document.createElement('video');
  screenVideo.srcObject = displayStream; cameraVideo.srcObject = cameraStream;
  screenVideo.muted = true; cameraVideo.muted = true; screenVideo.playsInline = true; cameraVideo.playsInline = true;
  await Promise.all([screenVideo.play(), cameraVideo.play()]);
  const source = displayStream.getVideoTracks()[0].getSettings();
  const canvas = document.createElement('canvas');
  canvas.width = source.width || 1280; canvas.height = source.height || 720;
  const ctx = canvas.getContext('2d');
  const draw = () => {
    ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
    const width = Math.round(canvas.width * .23), height = Math.round(width * 9 / 16), pad = Math.round(canvas.width * .025);
    ctx.save(); ctx.beginPath(); ctx.roundRect(canvas.width - width - pad, canvas.height - height - pad, width, height, Math.round(width * .08)); ctx.clip();
    ctx.drawImage(cameraVideo, canvas.width - width - pad, canvas.height - height - pad, width, height); ctx.restore();
    ctx.lineWidth = Math.max(2, Math.round(canvas.width / 500)); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeRect(canvas.width - width - pad, canvas.height - height - pad, width, height);
    compositor.frame = requestAnimationFrame(draw);
  };
  compositor = { frame: 0, screenVideo, cameraVideo };
  draw();
  return canvas.captureStream(Number($('framerate').value) || 30);
}
function mixAudio() {
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  [displayStream, micStream].filter(Boolean).forEach((stream) => {
    if (stream.getAudioTracks().length) context.createMediaStreamSource(stream).connect(destination);
  });
  const track = destination.stream.getAudioTracks()[0];
  if (!track) { context.close().catch(() => {}); return null; }
  mixer = context;
  return track;
}
function audioHintKey() {
  const haveMic = Boolean(micStream && micStream.getAudioTracks().length);
  const haveScreen = Boolean(displayStream && displayStream.getAudioTracks().length);
  if ($('microphone').checked && !haveMic) return haveScreen ? 'degradedMic' : 'degradedSurfaces';
  if (!$('screen-audio').checked || !haveScreen) return 'degradedScreenAudio';
  return null;
}

// ---- recording lifecycle ---------------------------------------------------
function armRecorder(stream, type) {
  const audio = mixAudio();
  const tracks = [...stream.getVideoTracks(), ...(audio ? [audio] : [])];
  recorder = new MediaRecorder(new MediaStream(tracks), {
    mimeType: type,
    videoBitsPerSecond: BITRATES[$('quality').value],
    audioBitsPerSecond: AUDIO_BITRATE
  });
  chunks = [];
  chunkBytes = 0;
  chunkSeq = 0;
  recorder.ondataavailable = (event) => {
    if (!event.data || !event.data.size) return;
    const payload = event.data;
    chunks.push(payload);
    chunkBytes += payload.size;
    saveChunk(payload, sessionStartedAt, chunkSeq++);
    if (Date.now() - lastMemorySync > 1000) { lastMemorySync = Date.now(); syncMemory(); }
    if (chunkBytes >= HEAP_LIMIT_BYTES) setHint('heapCritical', [fmtBytes(chunkBytes)], true);
    else if (chunkBytes >= HEAP_WARN_BYTES) setHint('heapWarn', [fmtBytes(chunkBytes)], true);
  };
  recorder.onstop = finish;
  recorder.onerror = () => { setHint('errRecorder', [], true); stop(); };
}
function beginRecording(stream) {
  const type = mediaType();
  if (!type) throw new Error(L('errUnsupported'));
  armRecorder(stream, type);
  sessionStartedAt = Date.now();
  startedAt = sessionStartedAt;
  pausedAt = 0;
  pausedTotal = 0;
  lastMemorySync = 0;
  setInProgress(true);
  recorder.start(TIMESLICE_MS);
  timer = setInterval(tick, 250);
  const auto = Number($('autostop').value);
  if (auto) stopTimer = setTimeout(stop, auto * 1000);
  const audioKey = audioHintKey();
  if (audioKey) setHint(audioKey, [], true);
  else if (captureNote) setHint(captureNote.key, captureNote.args);
  else setHint('recordingHint');
  show('recording');
  syncMemory();
  chrome.runtime.sendMessage({ type: 'recording-state', active: true }).catch(() => {});
}
function tick() {
  $('timer').textContent = fmt(elapsed());
}
async function start() {
  setNotice('');
  persist();
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: $('screen-audio').checked });
  } catch (error) {
    setNotice(captureError(error));
    resetStart();
    return;
  }
  chrome.storage.local.remove(['pendingLink', 'filenameSuggestion']).catch(() => {});
  const note = await applyOutputSize(displayStream);
  setCaptureNote(note && note.key, (note && note.args) || []);
  await addMic();
  try { await addCamera(); } catch { cameraStream = null; }
  const wait = Number($('countdown').value) || 0;
  if (wait) {
    $('start').disabled = true;
    for (let n = wait; n > 0; n--) {
      $('start').textContent = L('starting', n);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    $('start').disabled = false;
    $('start').textContent = L('btnStart');
  }
  const video = displayStream.getVideoTracks()[0];
  if (video) video.onended = () => stop();
  try {
    beginRecording(cameraStream ? await composePictureInPicture() : displayStream);
  } catch (error) {
    releaseCapture();
    setNotice(error && error.message ? error.message : L('errStart', 'unknown error'));
    resetStart();
  }
}
function pause() {
  if (!recorder) return;
  if (recorder.state === 'recording') {
    recorder.pause();
    pausedAt = Date.now();
    $('pause').textContent = L('btnResume');
    $('pause').dataset.i18n = 'btnResume';
  } else if (recorder.state === 'paused') {
    recorder.resume();
    pausedTotal += Date.now() - pausedAt;
    pausedAt = 0;
    $('pause').textContent = L('btnPause');
    $('pause').dataset.i18n = 'btnPause';
  }
}
const stop = () => { if (recorder && recorder.state !== 'inactive') recorder.stop(); };
function releaseCapture() {
  clearInterval(timer);
  clearTimeout(stopTimer);
  timer = null;
  stopTimer = null;
  if (compositor) { cancelAnimationFrame(compositor.frame); compositor.screenVideo.pause(); compositor.cameraVideo.pause(); compositor = null; }
  [displayStream, micStream, cameraStream].filter(Boolean).forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
  if (mixer) { mixer.close().catch(() => {}); mixer = null; }
}
function resetStart() {
  show('setup');
  $('start').disabled = false;
  $('start').textContent = L('btnStart');
  $('start').dataset.i18n = 'btnStart';
  displayStream = null;
  micStream = null;
  cameraStream = null;
  recorder = null;
  chunks = [];
  chunkBytes = 0;
  captureNote = null;
  setHint(null);
  syncMemory();
}
function finish() {
  releaseCapture();
  const type = (recorder && recorder.mimeType) || 'video/webm';
  finalBlob = new Blob(chunks, { type });
  finalSize = finalBlob.size;
  const url = URL.createObjectURL(finalBlob);
  $('preview').src = url;
  $('preview').onloadeddata = () => URL.revokeObjectURL(url);
  recorder = null;
  chunks = [];
  // Chunks stay in IndexedDB so the recovery banner can still offer them after a reload.
  Promise.all([...pendingWrites]).finally(() => setInProgress(false));
  chrome.runtime.sendMessage({ type: 'recording-state', active: false }).catch(() => {});
  show('result');
  syncMemory();
  setHint('resultSize', [fmtBytes(finalSize)]);
}
function download(blob = finalBlob) {
  if (!blob || !blob.size) { setNotice(L('errEmpty')); return; }
  const name = `${sanitized()}.webm`;
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  const fallback = () => { anchor.click(); setTimeout(() => URL.revokeObjectURL(anchor.href), 2000); };
  // chrome.downloads is what the declared permission is for: it keeps the chosen name and reports
  // failures. The anchor click stays as a fallback so a failed call can never lose the recording.
  if (!chrome.downloads || !chrome.downloads.download) { fallback(); return; }
  chrome.downloads.download({ url: anchor.href, filename: name, saveAs: false })
    .then((id) => {
      if (typeof id === 'number') { setTimeout(() => URL.revokeObjectURL(anchor.href), 60000); return; }
      // undefined means the download was rejected without throwing.
      fallback();
    })
    .catch(() => { fallback(); setNotice(L('errDownload')); });
}
const persistLang = () => chrome.storage.local.set({ lang: LANG }).catch(() => {});

// ---- messages and boot -----------------------------------------------------
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'stop-recording') stop();
  if (message.type === 'pause-recording') pause();
});
$('start').addEventListener('click', () => {
  if ($('start').dataset.i18n === 'btnStop') stop();
  else start();
});
$('stop').onclick = stop;
$('pause').onclick = pause;
$('download').onclick = () => download();
$('new-recording').onclick = () => { setNotice(''); setHint(null); show('setup'); };
$('language').onclick = () => {
  applyLang(LANG === 'zh' ? 'en' : 'zh');
  persistLang();
};
// Closing mid-recording loses the in-flight take; IndexedDB only keeps what already landed.
window.addEventListener('beforeunload', (event) => {
  if (!recorder || recorder.state === 'inactive') return;
  event.preventDefault();
  event.returnValue = '';
});
loadSettings()
  .then(() => applyLang(LANG))
  .then(() => Promise.all([readInProgress(), loadChunks()]))
  .then(([flag, stored]) => {
    if (flag === false || !stored.length) return;
    const size = stored.reduce((total, blob) => total + (blob.size || 0), 0);
    $('recovery-text').textContent = L('recoveryFound', fmtBytes(size));
    $('recovery').classList.remove('hidden');
    $('recover').onclick = () => {
      download(new Blob(stored, { type: 'video/webm' }));
      clearChunks().then(() => setInProgress(null)).then(() => $('recovery').classList.add('hidden'));
    };
    $('discard').onclick = () => {
      clearChunks().then(() => setInProgress(null)).then(() => $('recovery').classList.add('hidden'));
    };
  })
  .catch(() => {});
