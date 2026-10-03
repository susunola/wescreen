const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const recorderCode = fs.readFileSync(path.join(root, 'recorder.js'), 'utf8');
const extract = (start, end) => {
  const from = recorderCode.indexOf(start);
  const to = recorderCode.indexOf(end, from);
  assert.ok(from !== -1 && to > from, `Expected ${start} before ${end}`);
  return recorderCode.slice(from, to);
};

function captureContext({ camera = false, clicks = true, state = 'live' } = {}) {
  const video = { readyState: state };
  const stream = { getVideoTracks: () => [video] };
  const seen = { notices: [], recordings: [], compositions: 0, releases: 0 };
  const fields = {
    'quiet-tab-audio': { checked: false }, 'capture-method': { value: 'shared' },
    'screen-audio': { checked: true }, camera: { checked: camera }, clicks: { checked: clicks },
    recovery: { classList: { contains: () => true } }, countdown: { value: '0' }, start: { disabled: false, textContent: '' }
  };
  const context = {
    $: id => fields[id],
    navigator: { mediaDevices: { getDisplayMedia: async () => stream } },
    chrome: { storage: { local: { remove: () => Promise.resolve() } } },
    displayStream: null,
    cameraStream: camera ? {} : null,
    persist: () => {},
    acquireRecordingLock: async () => true,
    refreshRecovery: async () => false,
    prepareTelegramChannel: async () => {}, captureChannelContext: null,
    mixAudio: () => null, mixer: null, mediaType: () => 'video/webm',
    setNotice: text => seen.notices.push(text),
    captureError: error => error.message,
    resetStart: () => {},
    applyOutputSize: async () => null,
    setCaptureNote: () => {},
    addMic: async () => {},
    addCamera: async () => {},
    releaseCapture: () => { seen.releases++; },
    beginRecording: input => seen.recordings.push(input),
    composeOutput: async () => { seen.compositions++; return { composite: true }; },
    stop: () => {},
    L: key => key
  };
  vm.runInNewContext(extract('async function start()', 'function pause()'), context);
  return { context, seen, stream };
}

test('default click highlights record the original video track, not a background canvas', async () => {
  const { context, seen, stream } = captureContext();
  await context.start();
  assert.equal(seen.recordings[0], stream);
  assert.equal(seen.compositions, 0);
});

test('only camera picture-in-picture enters the compositor', async () => {
  for (const clicks of [false, true]) {
    const { context, seen } = captureContext({ camera: true, clicks });
    await context.start();
    assert.equal(seen.compositions, 1);
    assert.equal(seen.recordings[0].composite, true);
  }
});

test('turning click highlights off also leaves the screen video direct', async () => {
  const { context, seen, stream } = captureContext({ clicks: false });
  await context.start();
  assert.equal(seen.recordings[0], stream);
  assert.equal(seen.compositions, 0);
});

test('a screen track ending before recording cannot create an audio-only file', async () => {
  const { context, seen } = captureContext({ state: 'ended' });
  await context.start();
  assert.equal(seen.recordings.length, 0);
  assert.equal(seen.releases, 1);
  assert.equal(seen.notices.at(-1), 'errNoSource');
});

test('recorder rejects streams without a live video track before creating audio', () => {
  let mixed = false;
  const context = {
    L: key => key,
    mixAudio: () => { mixed = true; },
    MediaRecorder: class {},
    MediaStream: class {}
  };
  vm.runInNewContext(extract('function armRecorder(', 'async function beginRecording('), context);
  assert.throws(() => context.armRecorder({ getVideoTracks: () => [] }, 'video/webm'), /errNoSource/);
  assert.throws(() => context.armRecorder({ getVideoTracks: () => [{ readyState: 'ended' }] }, 'video/webm'), /errNoSource/);
  assert.equal(mixed, false);
});

test('unsupported background compositor fails explicitly before recording', async () => {
  const context = { window: {}, L: key => key };
  vm.runInNewContext(extract('async function composeOutput()', 'function mixAudio()'), context);
  await assert.rejects(context.composeOutput(), /pipUnsupported/);
});

function fakeElement() {
  return {
    children: [], style: {},
    append(child) { this.children.push(child); },
    remove() { this.removed = true; }
  };
}

test('pointer rings are inserted into the captured page only while recording', () => {
  const html = fakeElement();
  let onMessage, onPointer;
  const context = {
    globalThis: {},
    document: { documentElement: html, createElement: () => fakeElement() },
    innerWidth: 640,
    addEventListener: (type, callback) => { if (type === 'pointerdown') onPointer = callback; },
    chrome: { runtime: { onMessage: { addListener: callback => { onMessage = callback; } } } },
    requestAnimationFrame: callback => callback(),
    setTimeout: () => {}
  };
  const code = fs.readFileSync(path.join(root, 'pointer-tracker.js'), 'utf8');
  vm.runInNewContext(code, context);
  onPointer({ clientX: 120, clientY: 80 });
  assert.equal(html.children.length, 0);
  onMessage({ type: 'click-highlights-state', active: true });
  onPointer({ clientX: 120, clientY: 80 });
  assert.equal(html.children.length, 1);
  assert.equal(html.children[0].children.length, 1);
  assert.match(html.children[0].children[0].style.cssText, /left:120px;top:80px/);
  onMessage({ type: 'click-highlights-state', active: false });
  assert.equal(html.children[0].removed, true);
});

test('opening the recorder records the injected tab as the click-highlight target', async () => {
  let openRecorder;
  const operations = [];
  const nodes = {
    '#lead': { textContent: '' }, '#privacy': { textContent: '' }, '#github-download': { textContent: '' },
    '#open': { textContent: '', addEventListener: (_, callback) => { openRecorder = callback; } },
    '#open-link': { addEventListener: () => {} },
    '#record-url': { addEventListener: () => {} }
  };
  const chrome = {
    i18n: { getMessage: () => '' },
    tabs: { query: async () => [{ id: 42, url: 'https://example.com' }], create: async () => {} },
    scripting: { executeScript: async arg => operations.push({ kind: 'inject', id: arg.target.tabId }) },
    storage: { session: {
      set: async data => operations.push({ kind: 'target', id: data.pointerTargetTabId }),
      remove: async () => operations.push({ kind: 'clear' })
    } },
    runtime: { getURL: name => `chrome-extension://example/${name}` }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'popup.js'), 'utf8'), {
    chrome, document: { documentElement: {}, querySelector: selector => nodes[selector] }, window: { close: () => {} }
  });
  await openRecorder();
  assert.deepEqual(operations, [{ kind: 'inject', id: 42 }, { kind: 'target', id: 42 }]);
});

test('a delayed start message cannot re-enable highlights after stopping', async () => {
  let listener, resolveStart;
  const calls = [];
  const chrome = {
    commands: { onCommand: { addListener: () => {} } },
    runtime: { onMessage: { addListener: callback => { const previous=listener;listener=(...args)=>{previous?.(...args);return callback(...args);}; } } },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    storage: { session: { get: () => resolveStart ? Promise.resolve({ pointerTargetTabId: 42 }) : new Promise(resolve => { resolveStart = resolve; }) } },
    tabs: { sendMessage: async (_, payload) => calls.push(payload.active) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), { chrome });
  listener({ type: 'recording-state', active: true, highlightClicks: true });
  listener({ type: 'recording-state', active: false, highlightClicks: false });
  await new Promise(setImmediate);
  resolveStart({ pointerTargetTabId: 42 });
  await new Promise(setImmediate);
  assert.deepEqual(calls, [false]);
});

test('recording-state enables then disables the ring on the tracked tab', async () => {
  let listener;
  const calls = [];
  const chrome = {
    commands: { onCommand: { addListener: () => {} } },
    runtime: { onMessage: { addListener: callback => { const previous=listener;listener=(...args)=>{previous?.(...args);return callback(...args);}; } } },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    storage: { session: { get: async () => ({ pointerTargetTabId: 42 }) } },
    tabs: { sendMessage: async (id, payload) => { calls.push({ id, payload }); } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), { chrome });
  listener({ type: 'recording-state', active: true, highlightClicks: true });
  await new Promise(setImmediate);
  listener({ type: 'recording-state', active: false, highlightClicks: false });
  await new Promise(setImmediate);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].id, 42);
  assert.equal(calls[0].payload.active, true);
  assert.equal(calls[1].payload.active, false);
});

test('the complete recording script parses, not just extracted functions', () => {
  assert.doesNotThrow(() => new vm.Script(recorderCode));
});

test('a rejected resolution cap reports the actual uncapped output', async () => {
  const context = { $: id => ({ resolution: { value: '1080' }, framerate: { value: '60' } })[id] };
  vm.runInNewContext(extract('async function applyOutputSize(', '// Missing audio'), context);
  const note = await context.applyOutputSize({ getVideoTracks: () => [{ getSettings: () => ({ width: 3840, height: 2160 }), applyConstraints: async () => { throw new Error('unsupported'); } }] });
  assert.equal(note.key, 'capFailed');
  assert.equal(note.args[0], '3840×2160');
});

test('video bitrate scales with actual pixels and frame rate', () => {
  const context = { BITRATES: { standard: 6000000 }, $: id => ({ quality: { value: 'standard' }, framerate: { value: '30' } })[id] };
  vm.runInNewContext(extract('function videoBitrate(', 'async function acquireRecordingLock()'), context);
  assert.equal(context.videoBitrate({ getSettings: () => ({ width: 1920, height: 1080, frameRate: 30 }) }), 6000000);
  assert.equal(context.videoBitrate({ getSettings: () => ({ width: 3840, height: 2160, frameRate: 60 }) }), 48000000);
});

test('audio mixing is reused across segments and preserves headroom for two sources', () => {
  let contexts = 0, resumes = 0; const gains = [];
  const context = { mixedAudio: null, mixer: null, displayStream: { getAudioTracks: () => [{}] }, micStream: { getAudioTracks: () => [{}] }, AudioContext: class {
    constructor() { contexts++; }
    resume() { resumes++; return Promise.resolve(); }
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [this] } }; }
    createMediaStreamSource() { return { connect: gain => gain }; }
    createGain() { const node = { gain: {}, connect() {} }; gains.push(node); return node; }
  } };
  vm.runInNewContext(extract('function mixAudio()', 'function audioHintKey()'), context);
  const first = context.mixAudio();
  assert.equal(context.mixAudio(), first);
  assert.equal(contexts, 1);
  assert.equal(resumes, 1);
  assert.deepEqual(gains.map(node => node.gain.value), [0.5, 0.5]);
});

test('saved clip duration and markers exclude earlier segments and remain frozen', () => {
  let elapsedMs = 25000;
  const context = { finalDuration: 0, finalMarkers: [], segmentStartedElapsed: 20000, elapsed: () => elapsedMs, markers: [{ at: 1000 }, { at: 23000 }] };
  vm.runInNewContext(extract('function snapshotSegment()', 'async function saveSegmentAndContinue()'), context);
  context.snapshotSegment();
  assert.equal(context.finalDuration, 5000);
  assert.equal(context.finalMarkers.length, 1);
  assert.equal(context.finalMarkers[0].at, 3000);
  elapsedMs += 60000;
  assert.equal(context.finalDuration, 5000);
});


test('MP4 selection requires H.264 plus AAC and never falls back to a mislabeled WebM', () => {
  const context = { $: () => ({ value: 'mp4' }), MediaRecorder: { isTypeSupported: type => type === 'video/mp4;codecs=avc1,mp4a.40.2' }, recordingMime: 'video/mp4' };
  vm.runInNewContext(extract('const MP4_TYPES', 'function captureError'), context);
  assert.equal(context.mediaType(), 'video/mp4;codecs=avc1,mp4a.40.2');
  assert.equal(context.recordingExtension(), 'mp4');
  context.MediaRecorder.isTypeSupported = type => type.startsWith('video/webm');
  assert.equal(context.mediaType(), undefined);
});

test('Telegram mode refuses to silently record a video without shared audio', async () => {
  const { context, seen, stream } = captureContext();
  stream.getAudioTracks = () => [];
  const field = context.$;
  context.$ = id => id === 'capture-mode' ? { value: 'telegram' } : field(id);
  await context.start();
  assert.equal(seen.recordings.length, 0);
  assert.equal(seen.releases, 1);
  assert.equal(seen.notices.at(-1), 'telegramNoAudio');
});

test('completed segments stay in the library without triggering a download', async () => {
  let downloads = 0, archived = 0;
  const context = { Blob, recordingMime: 'video/webm', Promise,
    archiveRecording: async () => { archived++; return 'saved'; },
    download: () => { downloads++; }, storageError: () => {}, setHint: () => {} };
  vm.createContext(context);
  vm.runInContext(extract('async function saveCompletedSegment(', 'async function saveSegmentAndContinue('), context);
  const state = { chunks: [new Blob(['video'])], recorder: { mimeType: 'video/webm' }, writes: new Set(), index: 1 };
  assert.equal(await context.saveCompletedSegment(state), 'saved');
  assert.equal(archived, 1); assert.equal(downloads, 0); assert.equal(state.chunks.length, 0);
});

test('a failed segment archive does not trigger an unsolicited download', async () => {
  let downloads = 0;
  const context = { Blob, recordingMime: 'video/webm', Promise,
    archiveRecording: async () => { throw new Error('disk failure'); },
    download: () => { downloads++; }, storageError: () => {}, setHint: () => {} };
  vm.createContext(context);
  vm.runInContext(extract('async function saveCompletedSegment(', 'async function saveSegmentAndContinue('), context);
  await assert.rejects(context.saveCompletedSegment({ chunks: [new Blob(['video'])], recorder: {}, writes: new Set() }), /disk failure/);
  assert.equal(downloads, 0);
});
