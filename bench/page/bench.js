// Runs one encoder configuration over one corpus clip inside the browser and uploads the result.
// Two paths are compared on identical pixels:
//   mediarecorder  what recorder.js does today (real-time paced, bitrate target only)
//   webcodecs      VideoEncoder through Mediabunny (deterministic timestamps, full control)
import * as MB from '/vendor/mediabunny.mjs';

const pad = (i) => String(i).padStart(4, '0');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadMeta(clip) {
  return (await fetch(`/corpus/${clip}/meta.json`)).json();
}
async function loadFrame(clip, index) {
  const response = await fetch(`/corpus/${clip}/${pad(index)}.png`);
  return createImageBitmap(await response.blob());
}
async function upload(name, body) {
  const response = await fetch(`/result?name=${encodeURIComponent(name)}`, { method: 'POST', body });
  if (!response.ok) throw new Error(`upload failed: ${response.status}`);
}

// Every frame carries its own index (18 blocks of 16 px, sync "10" + 16 bits) so metrics.py can match decoded
// frames to the reference exactly, however the recorder drops or re-times them. Mirrors metrics.stamp_marker.
function stampMarker(context, index) {
  const bits = [1, 0, ...Array.from({ length: 16 }, (_, k) => (index >> (15 - k)) & 1)];
  bits.forEach((bit, k) => { context.fillStyle = bit ? '#fff' : '#000'; context.fillRect(k * 16, 0, 16, 16); });
}

async function runMediaRecorder(cfg, meta) {
  if (!MediaRecorder.isTypeSupported(cfg.mime)) return { skipped: `MediaRecorder does not support ${cfg.mime}` };
  const canvas = document.getElementById('c');
  canvas.width = meta.width;
  canvas.height = meta.height;
  const context = canvas.getContext('2d', { alpha: false });
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const options = { mimeType: cfg.mime, videoBitsPerSecond: cfg.bitrate };
  if (cfg.keyframeMs) options.videoKeyFrameIntervalDuration = cfg.keyframeMs;
  const recorder = new MediaRecorder(stream, options);
  const parts = [];
  recorder.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.start(1000);
  const started = performance.now();
  let next = loadFrame(cfg.clip, 0);
  for (let i = 0; i < meta.frames; i++) {
    const bitmap = await next;
    if (i + 1 < meta.frames) next = loadFrame(cfg.clip, i + 1);
    const wait = started + (i * 1000) / meta.fps - performance.now();
    if (wait > 0) await sleep(wait);
    context.drawImage(bitmap, 0, 0);
    stampMarker(context, i);
    track.requestFrame();
    bitmap.close();
  }
  await sleep(400);
  recorder.stop();
  await stopped;
  const blob = new Blob(parts, { type: recorder.mimeType });
  const ext = cfg.mime.includes('mp4') ? 'mp4' : cfg.mime.includes('matroska') ? 'mkv' : 'webm';
  await upload(`${cfg.id}.${ext}`, blob);
  return { wallMs: Math.round(performance.now() - started), reportedBitrate: recorder.videoBitsPerSecond, mime: recorder.mimeType };
}

function formatFor(container) {
  if (container === 'mp4') return { format: new MB.Mp4OutputFormat(), ext: 'mp4' };
  if (container === 'mkv') return { format: new MB.MkvOutputFormat(), ext: 'mkv' };
  return { format: new MB.WebMOutputFormat(), ext: 'webm' };
}

async function runWebCodecs(cfg, meta) {
  const quality = cfg.quantizer != null
    ? new MB.Quality({ quantizer: cfg.quantizer, bitrate: cfg.bitrate })
    : new MB.Quality({ bitrate: cfg.bitrate, bitrateMode: cfg.bitrateMode || 'variable' });
  const encoding = {
    codec: cfg.codec,
    quality,
    keyFrameInterval: cfg.keyframeSec ?? 2,
    latencyMode: cfg.latencyMode || 'quality',
    hardwareAcceleration: cfg.hw || 'no-preference',
  };
  if (cfg.contentHint) encoding.contentHint = cfg.contentHint;
  if (!(await MB.canEncodeVideo(cfg.codec, { width: meta.width, height: meta.height, frameRate: meta.fps, quality, latencyMode: encoding.latencyMode, hardwareAcceleration: encoding.hardwareAcceleration }))) {
    return { skipped: `WebCodecs cannot encode ${cfg.codec} with this configuration` };
  }
  const { format, ext } = formatFor(cfg.container);
  if (!format.getSupportedCodecs().includes(cfg.codec)) return { skipped: `${cfg.container} cannot hold ${cfg.codec}` };
  const output = new MB.Output({ format, target: new MB.BufferTarget() });
  const source = new MB.VideoSampleSource(encoding);
  output.addVideoTrack(source, { frameRate: meta.fps });
  await output.start();
  const stampCanvas = new OffscreenCanvas(meta.width, meta.height);
  const stampContext = stampCanvas.getContext('2d', { alpha: false });
  const started = performance.now();
  for (let i = 0; i < meta.frames; i++) {
    const bitmap = await loadFrame(cfg.clip, i);
    stampContext.drawImage(bitmap, 0, 0);
    stampMarker(stampContext, i);
    const frame = new VideoFrame(stampCanvas, { timestamp: Math.round((i * 1e6) / meta.fps), duration: Math.round(1e6 / meta.fps) });
    bitmap.close();
    const sample = new MB.VideoSample(frame);
    await source.add(sample);
    sample.close();
  }
  await output.finalize();
  const wallMs = Math.round(performance.now() - started);
  await upload(`${cfg.id}.${ext}`, new Blob([output.target.buffer], { type: await output.getMimeType() }));
  return { wallMs };
}

window.runConfig = async (cfg) => {
  const meta = await loadMeta(cfg.clip);
  try {
    return cfg.kind === 'mediarecorder' ? await runMediaRecorder(cfg, meta) : await runWebCodecs(cfg, meta);
  } catch (error) {
    return { error: String(error && error.message ? error.message : error) };
  }
};
window.capabilities = async () => {
  const out = { ua: navigator.userAgent, video: {}, mediaRecorder: {} };
  for (const codec of ['vp8', 'vp9', 'av1', 'avc', 'hevc']) {
    out.video[codec] = {};
    for (const hw of ['prefer-software', 'prefer-hardware']) {
      out.video[codec][hw] = await MB.canEncodeVideo(codec, { width: 1920, height: 1080, bitrate: 3e6, frameRate: 30, hardwareAcceleration: hw });
    }
  }
  for (const type of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=av1,opus', 'video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=hvc1.1.6.L120.90,mp4a.40.2', 'video/mp4;codecs=av01.0.08M.08,opus', 'video/x-matroska;codecs=avc1'])
    out.mediaRecorder[type] = MediaRecorder.isTypeSupported(type);
  return out;
};
window.benchReady = true;
