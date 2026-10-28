const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'export-tools.js'), 'utf8');

function harness({ health = { optimize: ['x265', 'gif', 'webp'] }, states = [{ state: 'processing', progress: .4 }, { state: 'done', progress: 1, mime: 'video/mp4', savedRatio: .62 }], selection = ['a'], entries, parts } = {}) {
  const seen = { requests: [], downloads: [], status: [] };
  const queue = [...states];
  const blobResult = { size: 1234, type: 'video/mp4' };
  const context = {
    E: (zh, en) => en, L: key => key,
    Blob: class { constructor(content, options) { this.content = content; this.type = options && options.type; this.size = 7; } },
    setTimeout, document: undefined,
    connectHelper: async () => health,
    readStore: async (store, id) => (store === 'videos' ? { size: 10 } : entries || [{ id: 'a', name: 'Lecture 1.webm' }]),
    recordingGroups: list => list.map(entry => ({ ...entry, _parts: parts || [entry] })),
    librarySelection: new Set(selection),
    enhancementRequest: async (url, options = {}) => {
      seen.requests.push([options.method || 'GET', url, options.body && typeof options.body === 'string' ? JSON.parse(options.body) : undefined]);
      if (url === '/uploads') return { json: async () => ({ id: '1'.repeat(32) }) };
      if (url === '/jobs/optimize') return { json: async () => ({ id: '2'.repeat(32) }) };
      if (url.endsWith('/result')) return { blob: async () => blobResult };
      if ((options.method || 'GET') === 'DELETE') return { json: async () => ({}) };
      return { json: async () => queue.length > 1 ? queue.shift() : queue[0] };
    },
    download: async (blob, name, recordingId) => { seen.downloads.push({ blob, name, recordingId }); }
  };
  vm.runInNewContext(source + '\nthis.helperExport = helperExport; this.exportFileName = exportFileName; this.selectedSingleRecording = selectedSingleRecording; this.EXPORT_PRESETS = EXPORT_PRESETS;', context);
  return { context, seen, hooks: { status: text => seen.status.push(text), sleep: async () => {}, pollMs: 0 } };
}

test('export names keep the base name, drop the old extension and never claim a different container', () => {
  const { context } = harness();
  const presets = context.EXPORT_PRESETS;
  assert.equal(context.exportFileName('Lecture 1.webm', presets.hevc), 'Lecture 1-small.mp4');
  assert.equal(context.exportFileName('demo.mp4', presets.gif), 'demo.gif');
  assert.equal(context.exportFileName('demo', presets.webp), 'demo.webp');
});

test('helper export uploads, polls to completion, downloads without touching the library and deletes the job', async () => {
  const { context, seen, hooks } = harness();
  const result = await context.helperExport({ id: 'a', name: 'Lecture 1.webm' }, 'hevc', hooks);
  assert.equal(result.name, 'Lecture 1-small.mp4');
  const methods = seen.requests.map(([method, url]) => `${method} ${url.replace(/[a-f0-9]{32}/, 'ID')}`);
  assert.deepEqual(methods.slice(0, 2), ['POST /uploads', 'POST /jobs/optimize']);
  assert.ok(methods.includes('GET /jobs/ID/result'));
  assert.ok(methods.includes('DELETE /jobs/ID'), 'the helper must not keep a copy of the recording');
  const body = seen.requests[1][2];
  assert.deepEqual([body.target, body.quality], ['x265', 'balanced']);
  assert.equal(seen.downloads.length, 1);
  assert.equal(seen.downloads[0].recordingId, null, 'result is exported, not attached to the original library entry');
  assert.ok(seen.status.some(text => text.includes('Converting 40%')));
  assert.match(seen.status.at(-1), /62% smaller/);
});

test('helper export reports an old helper, a missing encoder and a failed job, and still cleans up', async () => {
  let h = harness({ health: {} });
  await assert.rejects(h.context.helperExport({ id: 'a', name: 'x.mp4' }, 'gif', h.hooks), /Update and start the local helper/);
  h = harness({ health: { optimize: ['gif'] } });
  await assert.rejects(h.context.helperExport({ id: 'a', name: 'x.mp4' }, 'hevc', h.hooks), /cannot encode x265/);
  assert.equal(h.seen.requests.length, 0, 'nothing is uploaded when the helper cannot do the job');
  h = harness({ states: [{ state: 'error', error: 'Encoding failed' }] });
  await assert.rejects(h.context.helperExport({ id: 'a', name: 'x.mp4' }, 'hevc', h.hooks), /Encoding failed/);
  assert.ok(h.seen.requests.some(([method]) => method === 'DELETE'));
  assert.equal(h.seen.downloads.length, 0);
});

test('a larger-than-original HEVC result is flagged rather than celebrated', async () => {
  const { context, seen, hooks } = harness({ states: [{ state: 'done', progress: 1, mime: 'video/mp4', savedRatio: -0.2 }] });
  await context.helperExport({ id: 'a', name: 'x.mp4' }, 'hevc', hooks);
  assert.match(seen.status.at(-1), /larger than the original/);
});

test('selection must be exactly one single-part recording', async () => {
  await assert.rejects(harness({ selection: [] }).context.selectedSingleRecording(), /Select one recording/);
  await assert.rejects(harness({ selection: ['a', 'b'] }).context.selectedSingleRecording(), /Select one recording/);
  await assert.rejects(harness({ parts: [{ id: 'a' }, { id: 'b' }] }).context.selectedSingleRecording(), /merge it first/);
  const entry = await harness().context.selectedSingleRecording();
  assert.equal(entry.id, 'a');
});
