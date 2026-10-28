#!/usr/bin/env node
// Browser-side encoder benchmark: MediaRecorder (today's recorder.js path) vs WebCodecs + Mediabunny.
//
//   cd bench && npm install
//   node browser_bench.mjs --chrome "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" --headed
//   node browser_bench.mjs --suite quick --clips code_scroll web_scroll
//
// Run it on the machines your users have: hardware encoders only show up on real hardware, and they are
// the whole point. A headless cloud container only exercises software encoders.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const args = { clips: [], suite: 'quick', chrome: process.env.CHROME_PATH || '', headed: false, noSandbox: false, only: '', timeout: 240, capabilities: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--chrome') args.chrome = argv[++i];
    else if (a === '--suite') args.suite = argv[++i];
    else if (a === '--headed') args.headed = true;
    else if (a === '--no-sandbox') args.noSandbox = true;
    else if (a === '--only') args.only = argv[++i];
    else if (a === '--timeout') args.timeout = Number(argv[++i]);
    else if (a === '--capabilities') args.capabilities = true;
    else if (a === '--corpus') args.corpus = argv[++i];
    else if (a === '--clips') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) args.clips.push(argv[++i]); }
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

// Port of videoBitrate() in recorder.js so the MediaRecorder rows use what the extension really requests.
function extensionBitrate(meta, scene, quality) {
  const pixels = (meta.width * meta.height) / (1920 * 1080);
  const fps = Math.max(1, meta.fps) / 30;
  const base = scene === 'detail'
    ? (quality === 'high' ? 24e6 : quality === 'compact' ? 3e6 : 6e6)
    : (quality === 'high' ? 14e6 : quality === 'compact' ? 2.5e6 : 4e6);
  return Math.min(180e6, Math.round(base * Math.max(0.5, pixels ** 0.75) * fps ** 0.585));
}

export function buildSuite(meta, suite = 'quick') {
  const scene = meta.name === 'video_motion' ? 'motion' : 'detail';
  const rate = (q) => extensionBitrate(meta, scene, q);
  const base = { clip: meta.name };
  const cfgs = [];
  const mr = (id, mime, quality, extra = {}) => cfgs.push({ ...base, kind: 'mediarecorder', id: `${meta.name}__mr-${id}-${quality}`, mime, bitrate: rate(quality), group: `MediaRecorder ${id}`, param: `${quality}@${Math.round(rate(quality) / 1000)}k`, ...extra });
  const wcv = (id, codec, container, quality, extra = {}) => cfgs.push({ ...base, kind: 'webcodecs', id: `${meta.name}__wc-${id}-${quality}`, codec, container, bitrate: rate(quality), group: `WebCodecs ${id}`, param: `${quality}@${Math.round(rate(quality) / 1000)}k`, ...extra });
  const wcq = (id, codec, container, quantizer, extra = {}) => cfgs.push({ ...base, kind: 'webcodecs', id: `${meta.name}__wc-${id}-q${quantizer}`, codec, container, quantizer, group: `WebCodecs ${id}`, param: `q${quantizer}`, ...extra });

  for (const q of ['compact', 'standard', 'high']) mr('vp9', 'video/webm;codecs=vp9,opus', q);
  mr('av1', 'video/webm;codecs=av1,opus', 'standard');
  mr('mp4-av1', 'video/mp4;codecs=av01.0.08M.08,opus', 'standard');
  mr('mkv-avc', 'video/x-matroska;codecs=avc1', 'standard');
  mr('mp4-avc', 'video/mp4;codecs=avc1.640033,mp4a.40.2', 'standard');
  mr('mp4-hevc', 'video/mp4;codecs=hvc1.1.6.L120.90,mp4a.40.2', 'standard');
  for (const q of ['compact', 'standard', 'high']) wcv('vp9-vbr', 'vp9', 'webm', q);
  for (const quantizer of [30, 40, 50]) wcq('vp9-quantizer', 'vp9', 'webm', quantizer);
  wcv('av1-vbr', 'av1', 'mp4', 'standard');
  for (const quantizer of [40, 52]) wcq('av1-quantizer', 'av1', 'mp4', quantizer);
  for (const q of ['compact', 'standard']) wcv('avc-vbr', 'avc', 'mp4', q);
  wcv('hevc-vbr', 'hevc', 'mp4', 'standard', { hw: 'prefer-hardware' });
  if (suite === 'full') {
    for (const q of ['compact', 'standard', 'high']) wcv('av1-vbr', 'av1', 'mp4', q);
    for (const q of ['compact', 'standard', 'high']) mr('vp9-kf2s', 'video/webm;codecs=vp9,opus', q, { keyframeMs: 2000 });
    wcv('vp9-text', 'vp9', 'webm', 'standard', { contentHint: 'text' });
    wcv('vp9-realtime', 'vp9', 'webm', 'standard', { latencyMode: 'realtime' });
  }
  return cfgs;
}

async function findChrome(args) {
  if (args.chrome) return { executablePath: args.chrome, extraArgs: [] };
  try {
    const sparticuz = (await import('@sparticuz/chromium')).default;
    return { executablePath: await sparticuz.executablePath(), extraArgs: sparticuz.args };
  } catch { /* optional dependency */ }
  const candidates = [
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge',
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Chromium-based browser found. Pass --chrome <path> or set CHROME_PATH.');
  return { executablePath: found, extraArgs: [] };
}

function startServer({ corpus, out, mediabunny }) {
  const within = (base, target) => { const resolved = path.resolve(base, target); return resolved.startsWith(path.resolve(base) + path.sep) ? resolved : null; };
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (file) => {
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end('not found'); return; }
      res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    };
    if (req.method === 'POST' && url.pathname === '/result') {
      const name = path.basename(url.searchParams.get('name') || 'unnamed');
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => { fs.writeFileSync(path.join(out, name), Buffer.concat(chunks)); res.end('ok'); });
      return;
    }
    if (url.pathname === '/') return send(path.join(here, 'page', 'bench.html'));
    if (url.pathname === '/vendor/mediabunny.mjs') return send(mediabunny);
    if (url.pathname.startsWith('/page/')) return send(within(path.join(here, 'page'), url.pathname.slice(6)));
    if (url.pathname.startsWith('/corpus/')) return send(within(corpus, url.pathname.slice(8)));
    res.statusCode = 404; res.end('not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function evaluate(refDir, file) {
  const run = spawnSync('python3', [path.join(here, 'metrics.py'), '--ref', refDir, '--encoded', file], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(run.stderr.trim().split('\n').pop() || 'metrics failed');
  return JSON.parse(run.stdout);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const corpus = path.resolve(args.corpus || path.join(here, 'corpus'));
  const out = path.join(here, 'out', 'browser');
  const results = path.join(here, 'results', 'browser.jsonl');
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(path.dirname(results), { recursive: true });
  // The package only exports its entry point, so locate the prebuilt browser bundle next to it.
  const mediabunny = process.env.MEDIABUNNY_BUNDLE || path.join(path.dirname(require.resolve('mediabunny')), 'mediabunny.min.mjs');
  const puppeteer = (await import('puppeteer-core')).default;
  const chrome = await findChrome(args);
  const server = await startServer({ corpus, out, mediabunny });
  const launchArgs = [...chrome.extraArgs.filter((a) => !a.startsWith('--headless')), ...(args.noSandbox ? ['--no-sandbox'] : [])];
  const browser = await puppeteer.launch({ executablePath: chrome.executablePath, headless: args.headed ? false : 'shell', args: launchArgs });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => console.error('page error:', error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction('window.benchReady === true', { timeout: 30000 });
    if (args.capabilities) {
      console.log(JSON.stringify(await page.evaluate(() => window.capabilities()), null, 2));
      return;
    }
    const clips = fs.readdirSync(corpus).filter((n) => fs.existsSync(path.join(corpus, n, 'meta.json')) && (!args.clips.length || args.clips.includes(n)));
    const userAgent = await page.evaluate(() => navigator.userAgent);
    for (const clip of clips) {
      const meta = JSON.parse(fs.readFileSync(path.join(corpus, clip, 'meta.json'), 'utf8'));
      for (const cfg of buildSuite(meta, args.suite)) {
        if (args.only && !cfg.id.includes(args.only)) continue;
        const outcome = await Promise.race([
          page.evaluate((c) => window.runConfig(c), cfg),
          new Promise((resolve) => setTimeout(() => resolve({ error: `timeout after ${args.timeout}s` }), args.timeout * 1000)),
        ]);
        const label = `${clip.padEnd(14)} ${cfg.group.padEnd(24)} ${cfg.param.padEnd(14)}`;
        if (outcome.skipped || outcome.error) { console.log(`${label} skipped: ${outcome.skipped || outcome.error}`); continue; }
        const file = fs.readdirSync(out).find((n) => n.startsWith(`${cfg.id}.`));
        const row = { ...evaluate(path.join(corpus, clip), path.join(out, file)), encoder: cfg.group, param: cfg.param, source: 'browser', wall_ms: outcome.wallMs, reported_bitrate: outcome.reportedBitrate, browser: userAgent };
        fs.appendFileSync(results, JSON.stringify(row) + '\n');
        console.log(`${label} ${String(row.kbps).padStart(8)} kbps  ssim ${row.ssim}  edge ${row.edge_psnr}  frames ${row.frames_decoded}/${row.frames_expected}  (${outcome.wallMs} ms)`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
