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
    'screen-audio': { checked: true }, camera: { checked: camera }, clicks: { checked: clicks },
    countdown: { value: '0' }, start: { disabled: false, textContent: '' }
  };
  const context = {
    $: id => fields[id],
    navigator: { mediaDevices: { getDisplayMedia: async () => stream } },
    chrome: { storage: { local: { remove: () => Promise.resolve() } } },
    displayStream: null,
    cameraStream: camera ? {} : null,
    persist: () => {},
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
  vm.runInNewContext(extract('function armRecorder(', 'function beginRecording('), context);
  assert.throws(() => context.armRecorder({ getVideoTracks: () => [] }, 'video/webm'), /errNoSource/);
  assert.throws(() => context.armRecorder({ getVideoTracks: () => [{ readyState: 'ended' }] }, 'video/webm'), /errNoSource/);
  assert.equal(mixed, false);
});

test('camera composition detects stalled frames and stops instead of silently recording a still', async () => {
  let now = 1000, watchdog, stopped = 0;
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: () => {}, save: () => {}, beginPath: () => {}, roundRect: () => {}, clip: () => {}, restore: () => {}, strokeRect: () => {} }),
    captureStream: () => ({ getVideoTracks: () => [{ readyState: 'live' }] })
  };
  const context = {
    document: { createElement: tag => tag === 'canvas' ? canvas : { play: async () => {}, pause: () => {} } },
    displayStream: { getVideoTracks: () => [{ getSettings: () => ({ width: 640, height: 360 }) }] },
    cameraStream: { getVideoTracks: () => [{ readyState: 'live' }] },
    compositor: null,
    videoFailure: null,
    recorder: null,
    Date: { now: () => now },
    Math,
    $: id => ({ framerate: { value: '30' } })[id],
    requestAnimationFrame: () => 1,
    setInterval: callback => { watchdog = callback; return 1; },
    stop: () => { stopped++; }
  };
  vm.runInNewContext(extract('async function composeOutput()', 'function mixAudio()'), context);
  await context.composeOutput();
  context.recorder = { state: 'recording' };
  now += 4000;
  watchdog();
  assert.equal(stopped, 1);
  assert.equal(context.videoFailure, 'errVideoStalled');
});

function fakeElement() {
  return {
    children: [], style: {},
    append(child) { this.children.push(child); },
    remove() { this.removed = true; }
  };
}

test('a compositor that cannot draw its first frame fails before recording starts', async () => {
  const context = {
    document: { createElement: tag => tag === 'canvas' ? {
      getContext: () => ({ drawImage: () => { throw new Error('frame unavailable'); } })
    } : { play: async () => {} } },
    displayStream: { getVideoTracks: () => [{ getSettings: () => ({ width: 640, height: 360 }) }] },
    cameraStream: {},
    compositor: null,
    recorder: null,
    Date,
    $: () => ({ value: '30' }),
    stop: () => { throw new Error('should not call stop without a recorder'); }
  };
  vm.runInNewContext(extract('async function composeOutput()', 'function mixAudio()'), context);
  await assert.rejects(context.composeOutput(), /frame unavailable/);
});

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
    '#lead': { textContent: '' }, '#privacy': { textContent: '' },
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
    chrome, document: { querySelector: selector => nodes[selector] }, window: { close: () => {} }
  });
  await openRecorder();
  assert.deepEqual(operations, [{ kind: 'inject', id: 42 }, { kind: 'target', id: 42 }]);
});

test('a delayed start message cannot re-enable highlights after stopping', async () => {
  let listener, resolveStart;
  const calls = [];
  const chrome = {
    commands: { onCommand: { addListener: () => {} } },
    runtime: { onMessage: { addListener: callback => { listener = callback; } } },
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
    runtime: { onMessage: { addListener: callback => { listener = callback; } } },
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
