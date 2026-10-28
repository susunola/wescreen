// Exercises ProRecorder (WebCodecs + Mediabunny) in a real Chromium with a live canvas+audio MediaStream.
// Needs Playwright and ffprobe; skips cleanly without them. Uses VP9 inside MP4 because every Chromium build can
// software-encode it, whereas H.264/HEVC depend on the machine (the format->codec mapping is covered separately).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

let chromium;
try { ({ chromium } = require('playwright')); } catch { /* optional */ }
const hasFfprobe = spawnSync('ffprobe', ['-version']).status === 0;
const root = path.resolve(__dirname, '..');

const PAGE = `<!doctype html><meta charset=utf-8><canvas id=c width=640 height=360></canvas>
<script>window.chrome={runtime:{getURL:p=>'/'+p}};</script>
<script src="/pro-engine.js"></script>`;

async function withPage(run) {
  const results = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/out') {
      const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => { results.push(Buffer.concat(parts)); res.end('ok'); }); return;
    }
    if (url.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end(PAGE); return; }
    const file = path.join(root, url.pathname.replace(/^\/+/, ''));
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => { throw error; });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => typeof probeProEngine === 'function');
    await run(page, results);
  } finally { await browser.close(); server.close(); }
}

const RECORD = async ({ pauseMs = 0, codec = 'vp9', failEncoder = false }) => {
  await probeProEngine();
  if (!proEngine.ready) return { skipped: 'engine not ready: ' + (proEngine.error && proEngine.error.message) };
  const mb = proEngine.mb;
  if (!(await mb.canEncodeVideo(codec, { width: 640, height: 360, bitrate: 1e6, frameRate: 30 }))) return { skipped: codec + ' not encodable here' };
  const canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
  const audioContext = new AudioContext(); const destination = audioContext.createMediaStreamDestination();
  const osc = audioContext.createOscillator(); osc.connect(destination); osc.start();
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...destination.stream.getAudioTracks()]);
  let frame = 0; const draw = setInterval(() => { ctx.fillStyle = `hsl(${frame * 7 % 360} 70% 50%)`; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = '#fff'; ctx.font = '48px monospace'; ctx.fillText('frame ' + frame++, 40, 180); }, 33);
  const recorder = new ProRecorder(stream, { codec, format: 'mp4', videoBitsPerSecond: 1.5e6, audioBitsPerSecond: 96000 });
  const events = [], chunks = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); events.push('data'); };
  recorder.onstop = () => events.push('stop');
  recorder.onerror = e => events.push('error:' + (e.error && e.error.message));
  const started = new Promise(resolve => recorder.addEventListener('start', resolve, { once: true }));
  recorder.start(500);
  const stateAfterStart = recorder.state;
  await started;
  await new Promise(r => setTimeout(r, 1500));
  if (pauseMs) { recorder.pause(); const pausedState = recorder.state; await new Promise(r => setTimeout(r, pauseMs)); recorder.resume(); events.push('paused:' + pausedState + ':' + recorder.state); }
  await new Promise(r => setTimeout(r, 1500));
  recorder.stop();
  const stateAfterStop = recorder.state;
  await new Promise(resolve => { const t = setInterval(() => { if (events.includes('stop')) { clearInterval(t); resolve(); } }, 20); setTimeout(resolve, 8000); });
  clearInterval(draw); osc.stop();
  const blob = new Blob(chunks);
  await fetch('/out', { method: 'POST', body: blob });
  return { events, chunkCount: chunks.length, size: blob.size, mime: recorder.mimeType, stateAfterStart, stateAfterStop };
};

function probe(buffer) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wescreen-pro-')), 'out.mp4');
  fs.writeFileSync(file, buffer);
  const run = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration,format_name', '-of', 'json', file], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return { info: JSON.parse(run.stdout), file };
}

test('Pro engine records a fragmented MP4 with video and audio, emitted in time slices', { skip: !chromium || !hasFfprobe }, async () => {
  await withPage(async (page, results) => {
    const out = await page.evaluate(RECORD, { pauseMs: 0 });
    if (out.skipped) return console.log('skipped:', out.skipped);
    assert.deepEqual([out.stateAfterStart, out.stateAfterStop], ['recording', 'inactive']);
    assert.ok(!out.events.some(e => e.startsWith('error')), out.events.join(','));
    assert.ok(out.events.includes('stop'));
    assert.ok(out.chunkCount >= 3, `expected several time slices, got ${out.chunkCount}`);
    const { info } = probe(results[0]);
    const types = info.streams.map(s => s.codec_type).sort();
    assert.deepEqual(types, ['audio', 'video']);
    assert.equal(info.streams.find(s => s.codec_type === 'video').codec_name, 'vp9');
    assert.equal(info.streams.find(s => s.codec_type === 'video').width, 640);
    assert.ok(Math.abs(Number(info.format.duration) - 3) < 0.8, 'duration ' + info.format.duration);
    assert.match(info.format.format_name, /mp4/);
  });
});

test('Pro engine pause excludes the paused time from the recording', { skip: !chromium || !hasFfprobe }, async () => {
  await withPage(async (page, results) => {
    const out = await page.evaluate(RECORD, { pauseMs: 2000 });
    if (out.skipped) return console.log('skipped:', out.skipped);
    assert.ok(out.events.includes('paused:paused:recording'));
    const { info } = probe(results[0]);
    const duration = Number(info.format.duration);
    assert.ok(duration < 4.2 && duration > 2.0, `3 s recorded + 2 s paused should be about 3 s, got ${duration}`);
  });
});

test('a Pro recording cut off mid-stream is still playable (recovery concatenates chunks)', { skip: !chromium || !hasFfprobe }, async () => {
  await withPage(async (page, results) => {
    const out = await page.evaluate(RECORD, { pauseMs: 0 });
    if (out.skipped) return console.log('skipped:', out.skipped);
    const whole = results[0];
    const truncated = whole.subarray(0, Math.floor(whole.length * 0.6));
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wescreen-pro-')), 'cut.mp4');
    fs.writeFileSync(file, truncated);
    const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
    const frames = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    assert.ok(Number(frames.stdout.trim()) > 20, `truncated file should still decode frames, got "${frames.stdout.trim()}" ${decode.stderr}`);
  });
});

test('Pro engine support probe reports per-format codec availability and format->codec mapping', { skip: !chromium }, async () => {
  await withPage(async page => {
    const report = await page.evaluate(async () => {
      await probeProEngine();
      return { ready: proEngine.ready, formats: proEngine.formats, audio: proEngine.audioCodec, mime: proEngineMime('hevc'), avcMime: proEngineMime('mp4'), none: proEngineSupports('webm') };
    });
    assert.equal(report.ready, true);
    assert.deepEqual(Object.keys(report.formats).sort(), ['av1mp4', 'hevc', 'mp4']);
    assert.ok(report.audio);
    assert.match(report.mime, /^video\/mp4;codecs=hvc1,/);
    assert.match(report.avcMime, /^video\/mp4;codecs=avc1,/);
    assert.equal(report.none, false, 'WebM formats are never claimed by the Pro engine');
  });
});
