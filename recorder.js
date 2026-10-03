const $ = (id) => document.querySelector(`#${id}`);

const BITRATES = { compact: 2500000, standard: 6000000, high: 11000000 };
const AUDIO_BITRATE = 128000;
const TIMESLICE_MS = 1000;
// The whole recording is assembled in the tab heap at stop time, so the recorded payload —
// not the wall-clock length — is what decides whether the tab survives.
const HEAP_WARN_BYTES = 800 * 1024 * 1024;
// Rotate before the per-segment heap ceiling; this is not a total library capacity limit.
const AUTO_SEGMENT_BYTES = HEAP_WARN_BYTES;
const HEAP_LIMIT_BYTES = 1600 * 1024 * 1024;
const STORAGE_FLOOR_BYTES = 500 * 1024 * 1024;
const OPEN_QUALITIES = new Set(['source', '1080', '720']);

const I18N = {
  zh: {
    micDevice: '麦克风设备', defaultDevice: '系统默认', testMic: '测试麦克风', stopMicTest: '停止测试', micTesting: '请说话，观察电平；测试声音不会播放或保存。', micFailed: '无法打开麦克风，请检查权限和设备。', searchRecordings: '搜索录像名称', allCourses: '全部课程', uncategorized: '未分类', enhanceRecording: '画质增强', renameRecording: '重命名', renamePrompt: '输入新的录像名称', libraryTotal: (n, size) => `共 ${n} 条 · 占用 ${size}`, noMatches: '没有匹配的录像。',
    recordingLibrary: '录像清单', localLocation: '存储：浏览器本地录像库', downloadedLocation: (path) => `下载路径：${path}`, showFolder: '打开所在文件夹', libraryEmpty: '还没有保存的录像。', libraryHint: '录像保存在此浏览器本机，清除扩展数据或卸载扩展会删除录像，请下载备份。', openRecording: '打开播放', deleteRecording: '删除', confirmDelete: (name) => `删除本地录像“${name}”？已下载的文件不受影响。`, storageFailed: '本地保存失败，请立即下载录像备份。', resolveRecovery: '请先恢复或丢弃未完成的录像，再开始新录制。', alreadyRecording: '另一个录制页面正在录制，请先停止该录制。', capFailed: (res) => `分辨率限制未生效，实际输出 ${res}。`,
    langSwitch: 'English', pageTitle: 'WeScreen',
    eyebrow: '本地处理 · 保护隐私 · 为 EDGE 打造',
    privacy: '无账号 · 无上传 · 无追踪 —— 录制、混音和存储全部在这台设备上完成。',
    setupLead: '录制整个屏幕、窗口或标签页。所有媒体只在你的设备上处理。',
    smartRealtime: '智能最佳画质 · 实时 AI', cinemaMode: '影院模式', enhancementEnabled: '增强已开启', repairCaption: '生成高清新版本，保留原视频', enhanceMore: '更多增强设置 ›', originalPicture: '原画', instantViewing: '即时增强', playerView: '旋转与视图', instantEnhance: '一键画质增强', aiRepair: 'AI 高清修复', playbackSpeed: '倍速', playbackPip: '画中画', playbackVersion: '视频版本', playbackTuning: '画面缩放与实时调节', playbackZoom: '缩放（拖动画面移动，双击复位）', playbackBrightness: '亮度', playbackContrast: '对比度', playbackSharpness: '轻度锐化', playbackResetTuning: '恢复画质调节', playbackTuningHint: '实时调节仅影响当前观看；AI 修复通过画质增强生成新版本。', playbackKeys: '空格暂停 · ←/→ 跳转 5 秒 · R 旋转 · F 全屏 · M 静音', playbackAngle: '播放角度', playbackReset: '恢复方向', playbackFullscreen: '全屏', playbackPlay: '播放 / 暂停', playbackMute: '声音开关', quietTabAudio: '静音录制（仍保存视频声音）', quietTabAudioHint: '自动使用原视频标签页直采；临时开启网页播放器声音，但不播放到扬声器。停止后恢复原静音与音量。请先在视频标签页点击 WeScreen。', labelMode: '录制场景', modeGeneral: '普通录屏', modeTelegram: 'Telegram 频道视频', openTelegram: '打开 Telegram Web', telegramGuide: '先打开频道视频并暂停。开始录制时选择 Telegram 标签页并勾选共享音频；倒计时结束后切回视频播放，可进入全屏减少界面遮挡。桌面版请选择窗口，声音支持取决于系统。', telegramNoAudio: '没有采集到 Telegram 视频声音。请重新选择 Telegram 标签页并勾选共享音频。', telegramWebM: '当前浏览器不支持 MP4，已使用 WebM 视频预设。', labelFormat: '录制格式', formatMP4: 'MP4（H.264 + AAC，兼容优先）', formatWebM: 'WebM（VP9 / VP8）', errMP4: '当前浏览器不支持 H.264 + AAC 的 MP4 录制，请更新浏览器或选择 WebM。', labelFilename: '文件名', labelResolution: '分辨率', labelQuality: '画质', labelFrameRate: '帧率', labelCountdown: '倒计时', labelAutoStop: '自动停止', labelSegment: '长录制分段', advancedSettings: '高级录制设置',
    resSource: '原始分辨率', res1080: '1080p', res720: '720p',
    qualityStandard: '标准', qualityHigh: '高画质', qualityCompact: '节省空间',
    countdownNone: '不等待', countdown3: '3 秒', countdown5: '5 秒',
    autostopNone: '不设置', autostop5: '5 分钟', autostop15: '15 分钟', autostop30: '30 分钟', segmentOff: '仅按内存自动分段', segment15: '每 15 分钟', segment30: '每 30 分钟',
    legendSources: '音视频源', toggleScreenAudio: '系统 / 标签页音频', toggleMicrophone: '麦克风旁白', toggleCamera: '摄像头画中画', toggleClicks: '鼠标点击高亮（当前标签页）',
    btnStart: '开始录制', btnPause: '暂停', btnResume: '继续', btnStop: '停止录制', btnDownload: '下载录像', btnNotes: '下载学习笔记', btnMark: '标记重点', btnNewRecording: '录制下一条',
    btnRecover: '恢复并下载', btnDiscard: '丢弃',
    shortcutHint: '录制中可按 Ctrl/⌘ + Shift + S 停止；Ctrl/⌘ + Shift + U 暂停或继续。',
    recordingHint: '录制片段会暂存到本机，以便意外关闭后恢复。',
    resultTitle: '录制完成', githubDownload: 'GitHub 下载', courseMode: '课程录制模式', courseEnabled: '使用课程自动命名', courseName: '课程名称', episodeNumber: '第几集', episodeTitle: '本集标题', courseFilename: (name) => `将保存为：${name}`, courseLibrary: '本地课程库', exportCourse: '导出索引', segmentSaved: (n) => `第 ${n} 段已保存，正在继续录制。`, markerSaved: (time) => `已在 ${time} 标记重点。`,
    storageHint: (free) => `录像库存储余量约 ${free}（浏览器配额，不是磁盘剩余空间）。`,
    storageUnknown: '无法读取录像库配额余量。',
    starting: (n) => `${n}…`,
    memory: (used, limit) => `已录制约 ${used}（本次上限约 ${limit}）`,
    heapWarn: (used) => `录像已达 ${used}，请尽快停止并下载，以免浏览器内存不足。`,
    heapCritical: (used) => `录像已达 ${used}，接近浏览器内存上限，现在停止以保住这段录像。`,
    lowDisk: (free) => `录像库配额余量仅 ${free}，请导出并清理不需要的录像。`,
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
    errVideoStalled: '摄像头画中画合成画面已停止更新，录制已自动停止。可关闭“摄像头画中画”，直接录制屏幕，避免后台停帧。',
    errRecorder: '录制过程中浏览器报告了错误，已停止录制。',
    errUnsupported: '当前浏览器不支持 WebM 录制。',
    errStart: (msg) => `无法开始录制：${msg}`,
    errEmpty: '没有可下载的录像数据。',
    errDownload: '保存文件失败，请检查浏览器的下载设置。'
  },
  en: {
    micDevice: 'Microphone device', defaultDevice: 'System default', testMic: 'Test microphone', stopMicTest: 'Stop test', micTesting: 'Speak and watch the level. Test audio is not played or saved.', micFailed: 'Cannot open the microphone. Check permissions and device.', searchRecordings: 'Search recording names', allCourses: 'All courses', uncategorized: 'Uncategorized', enhanceRecording: 'Enhance', renameRecording: 'Rename', renamePrompt: 'Enter a new recording name', libraryTotal: (n, size) => `${n} recordings · ${size} used`, noMatches: 'No matching recordings.',
    recordingLibrary: 'Recordings', localLocation: 'Storage: browser local recording library', downloadedLocation: (path) => `Downloaded to: ${path}`, showFolder: 'Show in folder', libraryEmpty: 'No saved recordings yet.', libraryHint: 'Stored in this browser on this device. Clearing extension data or uninstalling removes recordings; download a backup.', openRecording: 'Play', deleteRecording: 'Delete', confirmDelete: (name) => `Delete local recording “${name}”? Downloaded files are unaffected.`, storageFailed: 'Local saving failed. Download a backup now.', resolveRecovery: 'Recover or discard the unfinished recording before starting a new one.', alreadyRecording: 'Another recorder is active. Stop it before starting a new recording.', capFailed: (res) => `Resolution cap was not applied. Actual output: ${res}.`,
    langSwitch: '中文', pageTitle: 'WeScreen',
    eyebrow: 'LOCAL · PRIVATE · EDGE',
    privacy: 'No account · No upload · No tracking — recording, mixing, and storage all happen on this device.',
    setupLead: 'Record your entire screen, a window, or a tab. All media is processed on your device only.',
    smartRealtime: 'Smart quality · Realtime AI', cinemaMode: 'Cinema mode', enhancementEnabled: 'Enhancement on', repairCaption: 'Creates a new version; preserves the original', enhanceMore: 'More enhancement settings ›', originalPicture: 'Original', instantViewing: 'Instant enhancement', playerView: 'Rotation & view', instantEnhance: 'Instant enhancement', aiRepair: 'AI HD repair', playbackSpeed: 'Speed', playbackPip: 'Picture in picture', playbackVersion: 'Video version', playbackTuning: 'Zoom and live adjustments', playbackZoom: 'Zoom (drag to pan, double-click to reset)', playbackBrightness: 'Brightness', playbackContrast: 'Contrast', playbackSharpness: 'Gentle sharpening', playbackResetTuning: 'Reset adjustments', playbackTuningHint: 'Live adjustments affect viewing only. AI enhancement creates a new version.', playbackKeys: 'Space pause · ←/→ seek 5s · R rotate · F fullscreen · M mute', playbackAngle: 'Angle', playbackReset: 'Reset rotation', playbackFullscreen: 'Fullscreen', playbackPlay: 'Play / Pause', playbackMute: 'Toggle sound', quietTabAudio: 'Silent recording (save video audio)', quietTabAudioHint: 'Uses original-tab capture. Temporarily enables the web player audio without playing through speakers; restores mute and volume on stop. Open WeScreen from the video tab first.', labelMode: 'Recording scenario', modeGeneral: 'General screen recording', modeTelegram: 'Telegram channel video', openTelegram: 'Open Telegram Web', telegramGuide: 'Open and pause the channel video first. Select the Telegram tab and enable shared audio in the capture picker. After the countdown, return and play the video; fullscreen reduces UI clutter. For the desktop app select its window; audio support varies by system.', telegramNoAudio: 'No Telegram audio was captured. Select the Telegram browser tab again and enable shared audio.', telegramWebM: 'MP4 is unavailable in this browser. The video preset uses WebM.', labelFormat: 'Recording format', formatMP4: 'MP4 (H.264 + AAC, compatible)', formatWebM: 'WebM (VP9 / VP8)', errMP4: 'This browser cannot record H.264 + AAC MP4. Update your browser or select WebM.', labelFilename: 'File name', labelResolution: 'Resolution', labelQuality: 'Quality', labelFrameRate: 'Frame rate', labelCountdown: 'Countdown', labelAutoStop: 'Auto stop', labelSegment: 'Long-recording segments', advancedSettings: 'Advanced recording settings',
    resSource: 'Source resolution', res1080: '1080p', res720: '720p',
    qualityStandard: 'Standard', qualityHigh: 'High', qualityCompact: 'Space saver',
    countdownNone: 'No wait', countdown3: '3 seconds', countdown5: '5 seconds',
    autostopNone: 'Off', autostop5: '5 minutes', autostop15: '15 minutes', autostop30: '30 minutes', segmentOff: 'Memory-based rotation only', segment15: 'Every 15 minutes', segment30: 'Every 30 minutes',
    legendSources: 'Audio and video sources', toggleScreenAudio: 'System / tab audio', toggleMicrophone: 'Microphone narration', toggleCamera: 'Camera picture-in-picture', toggleClicks: 'Highlight clicks (current tab)',
    btnStart: 'Start recording', btnPause: 'Pause', btnResume: 'Resume', btnStop: 'Stop recording', btnDownload: 'Download video', btnNotes: 'Download learning notes', btnMark: 'Mark important', btnNewRecording: 'Record next video',
    btnRecover: 'Recover and download', btnDiscard: 'Discard',
    shortcutHint: 'While recording: Ctrl/⌘ + Shift + S stops, Ctrl/⌘ + Shift + U pauses or resumes.',
    recordingHint: 'Chunks are written to this device so an accidental close can be recovered.',
    resultTitle: 'Recording complete', githubDownload: 'GitHub download', courseMode: 'Course recording mode', courseEnabled: 'Use course auto-naming', courseName: 'Course name', episodeNumber: 'Episode', episodeTitle: 'Episode title', courseFilename: (name) => `Will save as: ${name}`, courseLibrary: 'Local course library', exportCourse: 'Export index', segmentSaved: (n) => `Part ${n} saved. Recording continues.`, markerSaved: (time) => `Important moment marked at ${time}.`,
    storageHint: (free) => `About ${free} available in the recording library (browser quota, not disk free space).`,
    storageUnknown: 'Local storage availability could not be read.',
    starting: (n) => `${n}…`,
    memory: (used, limit) => `About ${used} recorded (soft limit ${limit})`,
    heapWarn: (used) => `${used} recorded — stop and download soon to avoid running the browser out of memory.`,
    heapCritical: (used) => `${used} recorded — close to the browser memory ceiling. Stop now to keep this recording.`,
    lowDisk: (free) => `Only ${free} of library quota remains. Export and remove unwanted recordings.`,
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
    errVideoStalled: 'Camera picture-in-picture stopped updating. Recording was stopped to avoid a frozen video. Turn off camera picture-in-picture to record the screen directly in the background.',
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

let displayStream = null, micStream = null, cameraStream = null, mixer = null, recorder = null, chunks = [], chunkBytes = 0, compositor = null, markers = [];
let startedAt = 0, pausedAt = 0, pausedTotal = 0, timer = null, stopTimer = null, segmentTimer = null, finalBlob = null, finalSize = 0, recordingStream = null, segmentIndex = 1, rollingSegment = false, videoFailure = null;
let stopRequested = false, storageFailure = false, mixedAudio = null, previewUrl = null, finalName = null, finalId = null, releaseRecordingLock = null;
let lastRecordingWrite=0;
let micTest = null, libraryRenderGeneration = 0;
let recordingMime = 'video/webm';
let sessionStartedAt = 0, lastMemorySync = 0, chunkSeq = 0;
let hintKey = null, hintArgs = [], hintAlerts = false, captureNote = null;

let finalDuration = 0, finalMarkers = [], segmentStartedElapsed = 0;
let activeSegment = null;
const segmentSaves = new Set();

const pad = (value) => String(value).padStart(2, '0');
const fmt = (ms) => `${pad(Math.floor(Math.floor(ms / 1000) / 60))}:${pad(Math.floor(ms / 1000) % 60)}`;
const elapsed = () => Date.now() - startedAt - pausedTotal - (pausedAt ? Date.now() - pausedAt : 0);

async function saveThumbnail(blob, id) {
  const video = document.createElement('video'); video.muted = true; video.preload = 'auto';
  const url = URL.createObjectURL(blob);
  try {
    const thumbnail = await new Promise(resolve => {
      const timeout = setTimeout(() => resolve(null), 3000);
      video.onerror = () => { clearTimeout(timeout); resolve(null); };
      let seeking = false;
      const capture = () => {
        if (seeking || !video.videoWidth || !video.videoHeight) return;
        clearTimeout(timeout);
        try {
          const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = Math.round(240 * video.videoHeight / video.videoWidth);
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        } catch { resolve(null); }
      };
      video.onloadedmetadata = () => {
        const duration = video.duration;
        if (Number.isFinite(duration) && duration > .1) { seeking = true; video.currentTime = Math.min(.5, duration / 3); }
      };
      video.onseeked = () => { seeking = false; capture(); };
      video.onloadeddata = capture;
      video.src = url;
    });
    if (!thumbnail) return;
    await runTx('recordings', 'readwrite', tx => {
      const store = tx.objectStore('recordings'), request = store.get(id);
      request.onsuccess = () => { if (request.result) store.put({ ...request.result, thumbnail }); };
    });
    for(const row of $('recording-items').children){if(row.dataset.recordingId===id){const image=row.querySelector('.recording-thumbnail');if(image)image.src=thumbnail;}}
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}
async function refreshMicDevices() {
  const select = $('mic-device'), selected = select.value;
  const devices = await navigator.mediaDevices.enumerateDevices();
  select.replaceChildren();
  const defaultOption = document.createElement('option'); defaultOption.value = ''; defaultOption.textContent = L('defaultDevice'); select.append(defaultOption);
  devices.filter(device => device.kind === 'audioinput' && device.deviceId !== 'default').forEach((device, index) => {
    const option = document.createElement('option'); option.value = device.deviceId; option.textContent = device.label || `Microphone ${index + 1}`; select.append(option);
  });
  if ([...select.options].some(option => option.value === selected)) select.value = selected;
}
async function stopMicTest() {
  if (!micTest) return;
  const test = micTest; micTest = null;
  clearInterval(test.timer); test.stream?.getTracks().forEach(track => track.stop());
  if (test.context) await test.context.close().catch(() => {});
  $('mic-level').value = 0; $('mic-status').textContent = ''; $('test-mic').textContent = L('testMic');
}
async function testMicrophone() {
  if (micTest) return stopMicTest();
  const test = { stream: null, context: null, timer: null }; micTest = test;
  $('test-mic').textContent = L('stopMicTest');
  try {
    const id = $('mic-device').value;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: id ? { deviceId: { exact: id } } : true });
    if (micTest !== test) { stream.getTracks().forEach(track => track.stop()); return; }
    test.stream = stream; test.context = new AudioContext(); await test.context.resume();
    if (micTest !== test) return;
    const analyser = test.context.createAnalyser(); analyser.fftSize = 256;
    test.context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    test.timer = setInterval(() => { analyser.getFloatTimeDomainData(samples); const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length); $('mic-level').value = Math.min(1, rms * 4); }, 100);
    $('mic-status').textContent = L('micTesting'); await refreshMicDevices();
  } catch { if (micTest === test) { await stopMicTest(); $('mic-status').textContent = L('micFailed'); } }
}

function clearPreview() {
  const video = $('preview');
  video.pause(); video.removeAttribute('src'); video.load();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}
function setPreview(blob) {
  if(typeof beginPlaybackSource==='function')beginPlaybackSource(finalId);
  clearPreview();
  if(typeof resetPlaybackRotation==='function')resetPlaybackRotation();
  const video = $('preview');
  previewUrl = URL.createObjectURL(blob);
  video.src = previewUrl;
}
// ---- view helpers ---------------------------------------------------------
function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / (1024 ** power);
  return `${power === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[power]}`;
}
let recordingView = 'setup';
function show(name) { recordingView = name; navigateWorkspace('capture'); }
const isRecording = () => !$('recording').classList.contains('hidden');
function sanitized() { return $('filename').value.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\.(webm|mp4)$/i, '') || 'wescreen-recording'; }
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

function hasUnlimitedStorage() {
  return location.protocol === 'chrome-extension:' && Boolean(chrome.runtime.getManifest?.().permissions?.includes('unlimitedStorage'));
}
function renderStorageHint() {
  if (!navigator.storage?.estimate) { $('storage-hint').textContent = L('storageUnknown'); return; }
  navigator.storage.estimate().then(({ quota = 0, usage = 0 }) => {
    if (hasUnlimitedStorage()) { $('storage-hint').textContent = L('unlimitedLibrary', fmtBytes(usage)); return; }
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
  $('library-search').placeholder=L('librarySearchPlaceholder');
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
  if (videoFailure && !$('result').classList.contains('hidden')) $('result-warning').textContent = L(videoFailure);
  syncMemory();
  renderStorageHint();
  if ($('course-enabled')) updateCourseFilename();
  window.dispatchEvent(new Event('wescreen-language'));
}

// ---- settings -------------------------------------------------------------
const SETTING_FIELDS = [
  ['mic-device', 'select'], ['capture-mode', 'select'], ['filename', 'text'], ['format', 'select'], ['resolution', 'select'], ['quality', 'select'], ['framerate', 'select'],
  ['channel-name', 'text'], ['channel-url', 'text'], ['channel-video-title', 'text'], ['channel-message-url', 'text'], ['channel-episode', 'text'], ['channel-folder', 'text'], ['countdown', 'select'], ['autostop', 'select'], ['segment-minutes', 'select'], ['quiet-tab-audio', 'checked'], ['screen-audio', 'checked'], ['microphone', 'checked'], ['camera', 'checked'], ['clicks', 'checked'], ['course-enabled', 'checked'], ['course-name', 'text'], ['episode-number', 'text'], ['episode-title', 'text']
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
  await refreshMicDevices().catch(() => {});
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
  $('course-enabled').checked = false;
  updateCourseFilename();
}

function updateCourseFilename() {
  const enabled = $('course-enabled').checked;
  const name = $('course-name').value.trim();
  const episode = Math.max(1, Number($('episode-number').value) || 1);
  const title = $('episode-title').value.trim();
  const hint = $('course-filename');
  if (!enabled || !name) { hint.textContent = ''; return; }
  const generated = `${name}-${String(episode).padStart(2, '0')}${title ? `-${title}` : ''}`.replace(/[\\/:*?"<>|]/g, '-');
  $('filename').value = generated;
  hint.textContent = L('courseFilename', `${generated}.${selectedExtension()}`);
}
async function saveCourseEntry() { return renderCourseLibrary(await readStore('recordings')); }
function renderCourseLibrary(entries) {
  const name = $('course-name').value.trim();
  const visible = entries.filter(entry => !entry.deletedAt && entry.course && (!name || entry.course === name)).sort((a,b) => (a.episode || 0) - (b.episode || 0));
  const list = $('course-items'); list.replaceChildren();
  for (const entry of visible) { const item = document.createElement('li'); item.textContent = `${entry.course} · ${entry.episode || '—'} · ${entry.name}`; list.append(item); }
  $('course-library').classList.toggle('hidden', !visible.length);
}

// ---- capture --------------------------------------------------------------
function applyCapturePreset() {
  queueMicrotask(()=>window.dispatchEvent(new Event('wescreen-capture-settings')));
  const telegram = $('capture-mode').value === 'telegram';
  $('telegram-guide').hidden = !telegram;$('preflight-enabled').checked=telegram;
  $('telegram-channel').hidden = !telegram; $('course-panel').hidden = true;
  if (!telegram) return;
  const mp4 = MP4_TYPES.some(type => MediaRecorder.isTypeSupported(type));
  const values = { format: mp4 ? 'mp4' : 'webm', resolution: 'source', quality: 'high', framerate: '30', countdown: '5', autostop: '0', 'segment-minutes': '0' };
  for (const [id, value] of Object.entries(values)) $(id).value = value;
  for (const id of ['microphone', 'camera', 'clicks', 'course-enabled']) $(id).checked = false;
  $('screen-audio').checked = true;
  updateCourseFilename(); updateTelegramFilename(); persist();
  setNotice(mp4 ? '' : L('telegramWebM'));
}
const MP4_TYPES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.640033,mp4a.40.2'];
function selectedExtension() { return $('format').value === 'mp4' ? 'mp4' : 'webm'; }
function mediaType() {
  const types = selectedExtension() === 'mp4' ? MP4_TYPES : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return types.find(type => MediaRecorder.isTypeSupported(type));
}
function recordingExtension() { return recordingMime.startsWith('video/mp4') ? 'mp4' : 'webm'; }
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
  if (settings.height > Number(resolution) + 2 || settings.width > Math.round(Number(resolution) * 16 / 9) + 2) return { key: 'capFailed', args: [after] };
  const scaled = (beforeHeight && afterHeight && afterHeight < beforeHeight) || (!beforeHeight && afterHeight <= Number(resolution) + 2);
  return { key: scaled ? 'scaledDown' : 'keepsSource', args: [after] };
}
// Missing audio is a degraded take, not a failure: recording always goes ahead.
async function addMic() {
  if (!$('microphone').checked) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, ...($('mic-device').value ? { deviceId: { exact: $('mic-device').value } } : {}) } });
  } catch { micStream = null; }
}
async function addCamera() {
  if (!$('camera').checked) return;
  cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
}
async function composeOutput() {
  if (!window.MediaStreamTrackProcessor || !window.MediaStreamTrackGenerator || !window.OffscreenCanvas) throw new Error(L('pipUnsupported'));
  const video = displayStream.getVideoTracks()[0], camera = cameraStream.getVideoTracks()[0];
  const processor = new MediaStreamTrackProcessor({ track: video });
  const cameraProcessor = new MediaStreamTrackProcessor({ track: camera });
  const output = new MediaStreamTrackGenerator({ kind: 'video' });
  const worker = new Worker('compositor-worker.js');
  compositor = { worker, output };
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(L('errVideoStalled'))), 10000);
    worker.onerror = event => { clearTimeout(timeout); reject(new Error(event.message || L('errVideoStalled'))); if (recorder?.state === 'recording') { videoFailure = 'errVideoStalled'; stop(); } };
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') { clearTimeout(timeout); resolve(); }
      if (data.type === 'error') { clearTimeout(timeout); reject(new Error(data.message)); if (recorder?.state !== 'inactive' && recorder) { videoFailure = 'errVideoStalled'; stop(); } }
    };
    worker.postMessage({ screen: processor.readable, camera: cameraProcessor.readable, output: output.writable, frameRate: Number($('framerate').value) || 30 }, [processor.readable, cameraProcessor.readable, output.writable]);
  });
  return new MediaStream([output]);
}
function mixAudio() {
  if (mixedAudio) return mixedAudio;
  if (![displayStream, micStream].some(stream => stream && stream.getAudioTracks().length)) return null;
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  [displayStream, micStream].filter(Boolean).forEach((stream) => {
    if (!stream.getAudioTracks().length) return;
    const gain = context.createGain();
    gain.gain.value = micStream && displayStream.getAudioTracks().length ? 0.5 : 1;
    context.createMediaStreamSource(stream).connect(gain).connect(destination);
  });
  const track = destination.stream.getAudioTracks()[0];
  if (!track) { context.close().catch(() => {}); return null; }
  mixer = context;
  context.resume().catch(error => setNotice(E('录音混音器无法启动：','Audio mixer could not start: ')+error.message));
  mixedAudio = track;
  return track;
}
function audioHintKey() {
  const haveMic = Boolean(micStream && micStream.getAudioTracks().length);
  const haveScreen = Boolean(displayStream && displayStream.getAudioTracks().length);
  if ($('microphone').checked && !haveMic) return haveScreen ? 'degradedMic' : 'degradedSurfaces';
  if (!haveMic && !haveScreen && $('screen-audio').checked) return 'degradedScreenAudio';
  return null;
}

function videoBitrate(track) {
  const { width = 1920, height = 1080, frameRate = Number($('framerate').value) || 30 } = track.getSettings();
  const factor = Math.max(0.5, Math.min(8, width * height / (1920 * 1080) * frameRate / 30));
  return Math.round((BITRATES[$('quality').value] || BITRATES.standard) * factor);
}
async function acquireRecordingLock() {
  if (!navigator.locks) return true;
  return new Promise((resolve, reject) => {
    navigator.locks.request('wescreen-recording', { ifAvailable: true }, lock => {
      if (!lock) { resolve(false); return; }
      return new Promise(release => { releaseRecordingLock = release; resolve(true); });
    }).catch(reject);
  });
}
function unlockRecording() {
  if (releaseRecordingLock) releaseRecordingLock();
  releaseRecordingLock = null;
}

// ---- recording lifecycle ---------------------------------------------------
function armRecorder(stream, type, state) {
  const videoTracks = stream.getVideoTracks();
  if (!videoTracks.length || videoTracks[0].readyState !== 'live') throw new Error(L('errNoSource'));
  const audio = mixAudio();
  const instance = new MediaRecorder(new MediaStream([...videoTracks, ...(audio ? [audio] : [])]), {
    mimeType: type, videoBitsPerSecond: videoBitrate(displayStream?.getVideoTracks()[0] || videoTracks[0]), audioBitsPerSecond: AUDIO_BITRATE
  });
  state = state || { session: crypto.randomUUID(), index: 1, chunks: [], bytes: 0, seq: 0, writes: new Set(), start: 0, name: `${sanitized()}.${recordingExtension()}` };
  state.recorder = instance;
  instance.ondataavailable = event => {
    if (!event.data?.size) return;
    state.chunks.push(event.data); state.bytes += event.data.size;
    const write = saveChunk(event.data, state.session, state.seq++); state.writes.add(write);
    write.then(()=>{lastRecordingWrite=Date.now();},storageError).finally(() => state.writes.delete(write));
    if (state === activeSegment) {
      chunks = state.chunks; chunkBytes = state.bytes; chunkSeq = state.seq;
      syncMemory();
      if (chunkBytes >= HEAP_LIMIT_BYTES) { setHint('heapCritical', [fmtBytes(chunkBytes)], true); stop(); }
      else if (chunkBytes >= AUTO_SEGMENT_BYTES && !rollingSegment) { setHint('autoSegment'); saveSegmentAndContinue().catch(error => { setNotice(error.message); stop(); }); }
    }
  };
  instance.onstop = () => {
    if (state === activeSegment && state.awaitingNext){releaseCapture();Promise.allSettled([...state.writes]).then(()=>discardSession(state.session)).catch(error=>setNotice(error.message)).finally(()=>{chrome.runtime.sendMessage({type:'recording-state',active:false,highlightClicks:false}).catch(()=>{});resetStart();});return;}
    if (state === activeSegment) finish().catch(error => setNotice(error.message));
    else {
      const saving = state.savePromise = saveCompletedSegment(state).catch(error => { storageError(); setNotice(error.message); stop(); });
      segmentSaves.add(saving); saving.finally(() => segmentSaves.delete(saving));
    }
  };
  instance.onerror = () => { videoFailure = 'errRecorder'; stop(); };
  return instance;
}
function segmentDetails(state, end = elapsed()) {
  return { duration: Math.max(0, end - state.start), markers: markers.filter(marker => marker.at >= state.start && marker.at <= end).map(marker => ({ ...marker, at: marker.at - state.start })), course: state.course, episode: state.episode, width: state.width, height: state.height, ...(state.channelMetadata || {}) };
}
function createSegment(index) {
  const settings = displayStream.getVideoTracks()[0].getSettings();
  return { session: crypto.randomUUID(), index, chunks: [], bytes: 0, seq: 0, writes: new Set(), start: 0,
    course: $('course-enabled').checked ? $('course-name').value.trim() : '', episode: Number($('episode-number').value) || 1,
    width: settings.width, height: settings.height, channelMetadata: activeSegment && recorder && recorder.state !== 'inactive' ? activeSegment.channelMetadata : captureChannelContext,
    name: `${sanitized()}${Number($('segment-minutes').value) || index > 1 ? `-part-${String(index).padStart(3, '0')}` : ''}.${recordingExtension()}` };
}
function selectSegment(state) {
  activeSegment = state; recorder = state.recorder; chunks = state.chunks; chunkBytes = state.bytes; chunkSeq = state.seq;
  segmentIndex = state.index; sessionStartedAt = state.session; segmentStartedElapsed = state.start;
}
function scheduleSegment() {
  clearTimeout(segmentTimer);
  const minutes = Number($('segment-minutes').value);
  if (minutes) segmentTimer = setTimeout(() => saveSegmentAndContinue().catch(error => { setNotice(error.message); stop(); }), minutes * 60000);
}
async function beginRecording(stream) {
  const type = mediaType();
  if (!type) throw new Error(L(selectedExtension() === 'mp4' ? 'errMP4' : 'errUnsupported'));
  lastRecordingWrite=Date.now();recordingMime = type; stopRequested = false; storageFailure = false; finalName = null; finalId = null;
  recordingStream = stream; markers = []; finalMarkers = []; finalDuration = 0; videoFailure = null;
  startedAt = Date.now(); pausedAt = 0; pausedTotal = 0; lastMemorySync = 0;
  const state = createSegment(1); armRecorder(stream, type, state);
  await setInProgress({ session: state.session, name: state.name, mimeType: type, index: state.index, course: state.course, episode: state.episode, ...(state.channelMetadata || {}) });
  selectSegment(state); recorder.start(TIMESLICE_MS);
  timer = setInterval(tick, 250);
  const auto = Number($('autostop').value); if (auto) stopTimer = setTimeout(stop, auto * 1000);
  scheduleSegment();
  const audioKey = audioHintKey();
  if (audioKey) setHint(audioKey, [], true); else if (captureNote) setHint(captureNote.key, captureNote.args); else setHint('recordingHint');
  $('copy-next-message').hidden=true;$('next-channel-video').disabled=false;$('next-channel-video').hidden=!captureChannelContext?.channelId;show('recording'); startLivePreview(stream); syncMemory();
  chrome.runtime.sendMessage({ type: 'recording-state', active: true, highlightClicks: $('clicks').checked }).catch(() => {});
}
function snapshotSegment() {
  finalDuration = Math.max(0, elapsed() - segmentStartedElapsed);
  finalMarkers = markers.filter(marker => marker.at >= segmentStartedElapsed && marker.at <= segmentStartedElapsed + finalDuration).map(marker => ({ ...marker, at: marker.at - segmentStartedElapsed }));
}
async function saveCompletedSegment(state) {
  const blob = new Blob(state.chunks, { type: state.recorder.mimeType || recordingMime });
  await Promise.allSettled([...state.writes]);
  let id = null;
  try { id = await archiveRecording(blob, state.name, state.session, state.index, false, state.details); }
  catch (error) { storageError(); throw error; }
  finally { download(blob, state.name, id); state.chunks = []; }
  state.savedId=id;setHint('segmentSaved', [state.index]);return id;
}
async function saveSegmentAndContinue() {
  if (rollingSegment || stopRequested || !activeSegment || recorder.state === 'inactive') return;
  rollingSegment = true;
  const previous = activeSegment;
  try {
    const next = createSegment(previous.index + 1); armRecorder(recordingStream, recordingMime, next);
    // Persist the new session while the old encoder is STILL RUNNING. Disk latency cannot cause a capture gap.
    await setInProgress({ session: next.session, name: next.name, mimeType: recordingMime, index: next.index, course: next.course, episode: next.episode, ...(next.channelMetadata || {}) });
    if (stopRequested || previous.recorder.state === 'inactive') { await discardSession(next.session); if (previous.recorder.state !== 'inactive') previous.recorder.stop(); return; }
    next.start = elapsed();
    await new Promise((resolve, reject) => { next.recorder.addEventListener('start', resolve, { once: true }); next.recorder.addEventListener('error', reject, { once: true }); next.recorder.start(TIMESLICE_MS); });
    if (pausedAt) next.recorder.pause();
    // Start-before-stop intentionally allows a tiny overlap instead of losing frames at the boundary.
    previous.details = segmentDetails(previous);
    selectSegment(next); previous.recorder.stop();
    if (stopRequested) next.recorder.stop(); else scheduleSegment();
  } finally { rollingSegment = false; }
}
function tick() {
  $('live-clock').textContent = fmt(elapsed());
  $('timer').textContent = fmt(elapsed());
}
async function start() {
  if ($('start').disabled) return;
  if (!$('recovery').classList.contains('hidden')) { setNotice(L('resolveRecovery')); return; }
  $('start').disabled = true;
  setNotice('');
  if($('quiet-tab-audio').checked){$('capture-method').value='tab';$('screen-audio').checked=true;}
  if($('capture-method').value==='tab'){try{if(!await chrome.permissions.request({permissions:['tabCapture']}))throw new Error(E('标签页采集权限未授予，请授权或使用共享选择器。','Tab capture permission denied. Grant it or use the sharing picker.'));}catch(error){setNotice(error.message);resetStart();return;}}
  persist();
  if (typeof stopMicTest === 'function') await stopMicTest();
  try {
    if (!await acquireRecordingLock()) { setNotice(L('alreadyRecording')); resetStart(); return; }
    if (await refreshRecovery()) { setNotice(L('resolveRecovery')); resetStart(); return; }
    if ($('capture-mode')?.value === 'telegram') await prepareTelegramChannel();
    else captureChannelContext = null;
    if (!mediaType()) throw new Error(L(selectedExtension() === 'mp4' ? 'errMP4' : 'errUnsupported'));
    displayStream = $('capture-method').value==='tab' ? await captureOriginalTab() : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: $('screen-audio').checked });
  } catch (error) {
    setNotice(captureError(error));
    resetStart();
    return;
  }
  chrome.storage.local.remove(['pendingLink', 'filenameSuggestion']).catch(() => {});
  if ($('capture-mode')?.value === 'telegram' && !displayStream.getAudioTracks().length) {
    releaseCapture(); setNotice(L('telegramNoAudio')); resetStart(); return;
  }
  if ($('capture-mode')?.value === 'telegram') displayStream.getVideoTracks()[0].contentHint = 'motion';
  const note = await applyOutputSize(displayStream);
  setCaptureNote(note && note.key, (note && note.args) || []);
  await addMic();
  try { await addCamera(); } catch (error) { releaseCapture(); setNotice(L('cameraFailed')); resetStart(); return; }
  try{if($('preflight-enabled')?.checked && !await confirmCaptureSource(displayStream)){releaseCapture();resetStart();return;}}catch(error){clearInterval(preflightTimer);await preflightAudio?.close().catch(()=>{});preflightAudio=null;resolvePreflight(false);$('preflight-video').srcObject=null;releaseCapture();setNotice(error.message);resetStart();return;}
  const wait = Number($('countdown').value) || 0;
  if (wait) {
    $('start').disabled = true;
    for (let n = wait; n > 0; n--) {
      $('start').textContent = L('starting', n);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    $('start').textContent = L('btnStart');
  }
  const video = displayStream.getVideoTracks()[0];
  if (!video || video.readyState !== 'live') {
    releaseCapture();
    setNotice(L('errNoSource'));
    resetStart();
    return;
  }
  video.onended = () => { videoFailure = 'errSourceEnded'; stop(); };
  try {
    // Click rings are drawn inside the shared tab; only camera PiP needs a canvas.
    mixAudio();
    if (mixer && mixer.state === 'suspended') await mixer.resume();
    await beginRecording(cameraStream ? await composeOutput() : displayStream);
    $('start').disabled = false;
  } catch (error) {
    releaseCapture();
    setNotice(error && error.message ? error.message : L('errStart', 'unknown error'));
    resetStart();
  }
}
function pause() {
  if(typeof advancingChannel!=='undefined' && advancingChannel)return;
  if (!recorder) return;
  if (recorder.state === 'recording') {
    recorder.pause();
    pausedAt = Date.now();
    $('pause').textContent = L('btnResume');
    $('pause').dataset.i18n = 'btnResume';
  } else if (recorder.state === 'paused') {
    const nextPending=activeSegment.awaitingNext;activeSegment.awaitingNext=false;recorder.resume();if(nextPending){$('next-channel-video').disabled=false;$('copy-next-message').hidden=true;scheduleSegment();}
    pausedTotal += Date.now() - pausedAt;
    pausedAt = 0;
    $('pause').textContent = L('btnPause');
    $('pause').dataset.i18n = 'btnPause';
  }
}
function markImportant() {
  if (!isRecording() || !recorder || recorder.state !== 'recording') return;
  const at = elapsed(); markers.push({ at, label: 'important' }); setHint('markerSaved', [fmt(at)]);
}
const stop = () => { stopRequested = true; clearTimeout(segmentTimer); if (!rollingSegment && recorder && recorder.state !== 'inactive') recorder.stop(); };
function releaseCapture() {
  clearInterval(timer);
  clearTimeout(stopTimer);
  clearTimeout(segmentTimer);
  timer = null;
  stopTimer = null;
  segmentTimer = null;
  if (compositor) { compositor.worker.terminate(); compositor.output.stop(); compositor = null; }
  stopLivePreview();if(typeof closeTabPlayback==='function')closeTabPlayback();
  [displayStream, micStream, cameraStream].filter(Boolean).forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
  mixedAudio = null;
  if (mixer) { mixer.close().catch(() => {}); mixer = null; }
  recordingStream = null;
}
function resetStart() {
  unlockRecording();
  show('setup');
  $('start').disabled = false;
  $('start').textContent = L('btnStart');
  $('start').dataset.i18n = 'btnStart';
  displayStream = null;
  micStream = null;
  cameraStream = null;
  recorder = null;
  recordingStream = null;
  rollingSegment = false;
  segmentIndex = 1;
  chunks = [];
  chunkBytes = 0;
  captureNote = null;
  videoFailure = null;
  setHint(null);
  syncMemory();
}
async function finish(savedBlob = null, savedName = null, archived = false, savedId = null) {
  if (!savedBlob) snapshotSegment();
  releaseCapture();
  const type = (recorder && recorder.mimeType) || recordingMime;
  finalBlob = savedBlob || new Blob(chunks, { type });
  finalName = savedName || activeSegment.name;
  finalSize = finalBlob.size;

  if ($('course-enabled').checked) { $('episode-number').value = String(Math.max(1, Number($('episode-number').value) || 1) + 1); persist(); updateCourseFilename(); }
  setPreview(finalBlob);
  $('result-warning').textContent = videoFailure ? L(videoFailure) : '';
  $('result-warning').hidden = !videoFailure;
  chunks = [];
  // Keep recovery chunks until the completed video has been stored atomically.
  await Promise.allSettled([...pendingWrites]);
  await Promise.allSettled([...segmentSaves]);
  if (!archived) { try { finalId = await archiveRecording(finalBlob, finalName, activeSegment.session, activeSegment.index, false, segmentDetails(activeSegment, activeSegment.start + finalDuration)); } catch { storageError(); } }
  if (archived) finalId = savedId;
  if(typeof attachPlaybackId==='function')attachPlaybackId(finalId);
  if (finalId) await completeTelegramRecording(activeSegment).catch(error => setNotice(error.message));
  unlockRecording();
  if (storageFailure) { $('result-warning').textContent = L('storageFailed'); $('result-warning').hidden = false; }
  recorder = null;
  chrome.runtime.sendMessage({ type: 'recording-state', active: false, highlightClicks: false }).catch(() => {});
  show('result');
  (finalId ? readStore('recordings',finalId) : Promise.resolve(null)).then(renderRecordingReview).catch(error=>$('review-summary').textContent=error.message);
  syncMemory();
  setHint('resultSize', [fmtBytes(finalSize)]);
}
async function download(blob = finalBlob, explicitName = null, recordingId = finalId) {
  if (!blob || !blob.size) { setNotice(L('errEmpty')); return; }
  const baseName = explicitName || finalName || `${sanitized()}.${recordingExtension()}`;
  const entry = recordingId && blob.type.startsWith('video/') ? await readStore('recordings', recordingId).catch(() => null) : null;
  const folder = relativeFolder(entry?.exportFolder || '');
  const name = folder ? `${folder}/${baseName}` : baseName;
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  const fallback = () => { anchor.click(); setTimeout(() => URL.revokeObjectURL(anchor.href), 2000); };
  // chrome.downloads is what the declared permission is for: it keeps the chosen name and reports
  // failures. The anchor click stays as a fallback so a failed call can never lose the recording.
  if (!chrome.downloads || !chrome.downloads.download) { fallback(); return; }
  chrome.downloads.download({ url: anchor.href, filename: name, saveAs: false })
    .then((id) => {
      if (typeof id === 'number') {
        if (recordingId && blob.type.startsWith('video/') && chrome.downloads.search) saveDownloadLocation(recordingId, id).catch(error => { $('library-status').textContent = error.message; });
        setTimeout(() => URL.revokeObjectURL(anchor.href), 60000); return;
      }
      // undefined means the download was rejected without throwing.
      fallback();
    })
    .catch(() => { fallback(); setNotice(L('errDownload')); });
}
async function saveDownloadLocation(recordingId, downloadId) {
  const [item] = await chrome.downloads.search({ id: downloadId });
  // Read and update in one transaction so a delayed download cannot resurrect a deleted video.
  await runTx('recordings', 'readwrite', tx => {
    const store = tx.objectStore('recordings');
    const request = store.get(recordingId);
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, downloadId, downloadPath: item && item.filename || '', downloadExists: item?.exists !== false, downloadState: item?.state || 'in_progress' });
    };
  });
  await renderRecordingLibrary();
}
function downloadNotes() {
  const payload = { title: (finalName || sanitized()).replace(/\.(webm|mp4)$/i, ''), durationSeconds: Math.round(finalDuration / 1000), markers: finalMarkers, createdAt: new Date().toISOString() };
  download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${(finalName || sanitized()).replace(/\.(webm|mp4)$/i, '')}.learning-notes.json`);
}
const persistLang = () => chrome.storage.local.set({ lang: LANG }).catch(() => {});

// ---- messages and boot -----------------------------------------------------
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if(message.type==='get-recording-status'){respond({active:!!recorder && recorder.state!=='inactive',paused:recorder?.state==='paused',elapsed:elapsed(),volume:Number($('live-level').value)});return;}
  if(['stop-recording','pause-recording','mark-important'].includes(message.type))respond?.({ok:true});
  if (message.type === 'stop-recording') stop();
  if (message.type === 'pause-recording') pause();
  if (message.type === 'mark-important') markImportant();
});
$('start').addEventListener('click', () => {
  if ($('start').dataset.i18n === 'btnStop') stop();
  else start();
});
$('test-mic').onclick = testMicrophone;
$('mic-device').onchange = () => { stopMicTest(); persist(); };
$('library-search').oninput = () => { libraryPage = 0; renderRecordingLibrary().catch(error => { $('library-status').textContent = error.message; }); };
$('library-course').onchange = $('library-search').oninput;
$('capture-mode').onchange = applyCapturePreset;
$('stop').onclick = stop;
$('pause').onclick = pause;
$('mark').onclick = markImportant;
$('download').onclick = () => download();
$('notes').onclick = downloadNotes;
$('export-course').onclick = async () => { const entries = (await readStore('recordings')).filter(entry => entry.course && !entry.deletedAt); download(new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' }), 'wescreen-course-index.json'); };
function prepareNextRecording() { $('preview').pause(); setNotice(''); setHint(null); show('setup'); window.scrollTo({top:0}); }
$('new-recording').onclick = prepareNextRecording;
$('result-library').onclick = () => { $('preview').pause(); navigateWorkspace('library'); };
$('language').onclick = () => {
  applyLang(LANG === 'zh' ? 'en' : 'zh');
  persistLang();
  renderRecordingLibrary().catch(() => {});
};
['format', 'course-enabled', 'course-name', 'episode-number', 'episode-title'].forEach(id => $(id).addEventListener('input', () => { updateCourseFilename(); if (id === 'course-name') saveCourseEntry().catch(error => setNotice(error.message)); }));
// Closing mid-recording loses the in-flight take; IndexedDB only keeps what already landed.
window.addEventListener('beforeunload', (event) => {
  if (!releaseRecordingLock && (!recorder || recorder.state === 'inactive')) return;
  event.preventDefault();
  event.returnValue = '';
});
async function refreshRecovery() {
  const sessions = await pendingSessions();
  let bytes = 0;
  for (const state of sessions) bytes += (await loadChunks(state.session)).reduce((total, blob) => total + blob.size, 0);
  $('recovery-text').textContent = L('recoveryFound', fmtBytes(bytes));
  $('recovery').classList.toggle('hidden', sessions.length === 0);
  return sessions.length > 0;
}
async function handleRecovery(keep) {
  if (!await acquireRecordingLock()) return setNotice(L('alreadyRecording'));
  $('recover').disabled = true; $('discard').disabled = true; $('start').disabled = true;
  try {
    // Read after acquiring the lock, never use the snapshot from page load.
    const sessions = await pendingSessions();
    for (const state of sessions) {
      const stored = await loadChunks(state.session);
      if (keep && stored.length) {
        const blob = new Blob(stored, { type: state.mimeType || 'video/webm' });
        let id = null;
        try { id = await archiveRecording(blob, state.name || 'recovered-recording.webm', state.session, state.index || 1, true, { course: state.course || '', episode: state.episode, channelId: state.channelId, channelName: state.channelName, channelUrl: state.channelUrl, sourceUrl: state.sourceUrl, sourceTitle: state.sourceTitle, exportFolder: state.exportFolder, recovered: true }); }
        finally { download(blob, state.name || 'recovered-recording.webm', id); }
      } else await discardSession(state.session);
    }
    await refreshRecovery();
  } catch (error) { setNotice(L('storageFailed') + ' ' + error.message); }
  finally { unlockRecording(); $('recover').disabled = false; $('discard').disabled = false; $('start').disabled = false; }
}
$('recover').onclick = () => handleRecovery(true);
$('discard').onclick = () => handleRecovery(false);
window.addEventListener('wescreen-storage-closed', () => setNotice(L('databaseClosed')));
window.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadSettings(); applyLang(LANG); $('telegram-guide').hidden = $('capture-mode').value !== 'telegram';
    await db; await navigator.storage?.persist?.().catch(() => false);
    await refreshRecovery(); await refreshMicDevices().catch(() => {}); await renderRecordingLibrary();
    await initWorkspace(); document.documentElement.dataset.ready = "true";
  } catch (error) { setNotice(error.message); $('library-status').textContent = error.message; }
});
