const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'auto-shrink.js'), 'utf8');

function harness({ info = { state: 'done', progress: 1, savedRatio: .5 }, health = { optimize: ['svtav1', 'x265'] }, duration = 60000, requestError } = {}) {
  const store = { meta: {}, tasks: {} }, seen = { requests: [], saved: [] };
  const elements = {};
  const element = () => ({ value: 'svtav1', checked: true, addEventListener() {}, setAttribute() {}, append() {}, textContent: '' });
  const context = {
    E: (zh, en) => en, L: key => key, SETTING_FIELDS: [], captureProGrid: { append() {} }, persist() {}, window: { addEventListener() {} },
    setInterval: () => 0, clearInterval() {},
    proControl: () => ({}),
    document: { createElement: () => ({ ...element(), append() {}, setAttribute() {} }) },
    Option: class {},
    $: id => (elements[id] ||= element()),
    helperHealth: health,
    navigator: { locks: { request: async (_name, _options, run) => run({}) } },
    readStore: async (name, id) => {
      if (name === 'recordings') return [{ id: 'rec', name: 'demo.webm', duration, captureContent: 'detail' }];
      if (name === 'videos') return { size: 10 };
      return store[name][id];
    },
    runTx: async (name, _mode, run) => { const tx = { objectStore: () => ({ get: key => { const r = {}; Promise.resolve().then(() => { r.result = store.meta[key]; r.onsuccess && r.onsuccess(); }); return r; }, put: (value, key) => { if (name === 'meta') store.meta[key] = value; else store.tasks[value.id] = value; } }) }; await run(tx); await new Promise(r => setTimeout(r, 0)); },
    saveTaskResult: async task => { seen.saved.push(task); return 'new-id'; },
    enhancementRequest: async (url, options = {}) => {
      seen.requests.push([options.method || 'GET', url, options.body && typeof options.body === 'string' ? JSON.parse(options.body) : undefined]);
      if (requestError && url === '/uploads') throw new Error(requestError);
      if (url === '/uploads') return { json: async () => ({ id: '1'.repeat(32) }) };
      if (url === '/jobs/optimize') return { json: async () => ({ id: '2'.repeat(32) }) };
      return { json: async () => info };
    },
    setTimeout
  };
  context.$('result');
  vm.runInNewContext(source + '\nthis.shrinkPlan = shrinkPlan; this.queueAutoShrink = queueAutoShrink; this.processShrinkQueue = processShrinkQueue;', context);
  return { context, store, seen, elements };
}

test('shrinkPlan prefers the chosen encoder, falls back to HEVC, never invents one, and eases effort on long recordings', () => {
  const { context } = harness();
  assert.deepEqual({ ...context.shrinkPlan({ optimize: ['svtav1', 'x265'] }, 'svtav1', 1000) }, { target: 'svtav1', quality: 'balanced', effort: 'balanced' });
  assert.equal(context.shrinkPlan({ optimize: ['x265'] }, 'svtav1', 1000).target, 'x265');
  assert.equal(context.shrinkPlan({ optimize: ['gif'] }, 'svtav1', 1000), null);
  assert.equal(context.shrinkPlan({}, 'svtav1', 1000), null);
  assert.equal(context.shrinkPlan({ optimize: ['svtav1'] }, 'svtav1', 11 * 60000).effort, 'fast');
});

test('a clearly smaller result is saved as a new library copy and the helper job is deleted', async () => {
  const { context, seen, store } = harness();
  await context.queueAutoShrink('rec'); // also starts processing on its own
  await new Promise(r => setTimeout(r, 60));
  await context.processShrinkQueue();
  const create = seen.requests.find(r => r[1] === '/jobs/optimize');
  assert.equal(create[2].target, 'svtav1'); assert.equal(create[2].sourceId, 'rec'); assert.equal(create[2].screenContent, true);
  assert.equal(seen.saved.length, 1);
  assert.equal(seen.saved[0].sourceId, 'rec');
  assert.equal(store.meta['auto-shrink-pending'].length, 0);
  assert.ok(seen.requests.some(r => r[0] === 'DELETE'));
});

test('a result that is not clearly smaller is dropped and only the original is kept', async () => {
  const { context, seen, store } = harness({ info: { state: 'done', progress: 1, savedRatio: .05 } });
  await context.queueAutoShrink('rec'); // also starts processing on its own
  await new Promise(r => setTimeout(r, 60));
  await context.processShrinkQueue();
  assert.equal(seen.saved.length, 0);
  assert.equal(store.meta['auto-shrink-pending'].length, 0);
});

test('a busy or unreachable helper leaves the job queued for another try instead of failing it', async () => {
  const { context, store } = harness({ requestError: 'Helper is busy; showing original video' });
  await context.queueAutoShrink('rec'); // also starts processing on its own
  await new Promise(r => setTimeout(r, 60));
  await context.processShrinkQueue();
  const queue = store.meta['auto-shrink-pending'];
  assert.equal(queue.length, 1);
  assert.equal(queue[0].error, undefined);
});
