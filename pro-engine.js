// Pro recording engine: WebCodecs (via the vendored Mediabunny) behind a MediaRecorder-shaped adapter.
//
// Why it exists: MediaRecorder only exposes a bitrate target, the codecs the OS happens to wire up, and a
// muxer that writes WebM/MP4 with no seek index until the end. WebCodecs gives direct control of the
// encoder (H.264 / HEVC / AV1, hardware or software), and Mediabunny writes *fragmented* MP4, so a
// recording cut short by a crash or a closed tab is still a playable file and chunk concatenation stays valid.
//
// ProRecorder deliberately mimics the small part of MediaRecorder that recorder.js uses (start, pause,
// resume, stop, state, mimeType, ondataavailable/onstop/onerror, addEventListener) so the recorder's
// chunk storage, rotation and recovery code runs unchanged. It is opt-in (the "engine" setting) and never
// silently replaces a codec: if the chosen format cannot be encoded the recording refuses to start, as with MP4.

const PRO_FORMAT_CODECS = { mp4: 'avc', hevc: 'hevc', av1mp4: 'av1' };
// Fragments are cut at keyframes, so this is also the worst-case amount of video a crash can lose (MediaRecorder: ~1 s).
// Longer intervals save bytes; see bench/RESULTS.md notes on keyframe cost.
const PRO_KEYFRAME_SECONDS = 2;
const proEngine = { mb: null, ready: false, error: null, formats: {}, audioCodec: null, probing: null };

async function probeProEngine(loader) {
  if (proEngine.probing) return proEngine.probing;
  proEngine.probing = (async () => {
    try {
      const mb = await (loader ? loader() : import(chrome.runtime.getURL('vendor/mediabunny.min.mjs')));
      proEngine.mb = mb;
      const audio = await mb.getFirstEncodableAudioCodec(new mb.Mp4OutputFormat().getSupportedAudioCodecs(), { numberOfChannels: 2, sampleRate: 48000, bitrate: 128000 });
      proEngine.audioCodec = audio || null;
      for (const [format, codec] of Object.entries(PRO_FORMAT_CODECS)) {
        proEngine.formats[format] = !!(await mb.canEncodeVideo(codec, { width: 1920, height: 1080, bitrate: 6e6, frameRate: 30 }));
      }
      proEngine.ready = true;
    } catch (error) {
      proEngine.error = error;
      proEngine.ready = false;
    }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('wescreen-capture-settings'));
    return proEngine;
  })();
  return proEngine.probing;
}

function proEngineSupports(format) {
  return !!(proEngine.ready && proEngine.audioCodec && proEngine.formats[format]);
}

// Test hook: choose the codec per format without touching browser support probing.
function proEngineCodec(format, override) { return override || PRO_FORMAT_CODECS[format]; }

function proEngineMime(format, override) {
  const codec = proEngineCodec(format, override);
  const video = codec === 'avc' ? 'avc1' : codec === 'hevc' ? 'hvc1' : codec === 'av1' ? 'av01' : codec === 'vp9' ? 'vp09' : codec;
  const audio = proEngine.audioCodec === 'aac' ? 'mp4a.40.2' : proEngine.audioCodec || 'opus';
  return `video/mp4;codecs=${video},${audio}`;
}

class ProRecorder {
  constructor(stream, options = {}) {
    if (!proEngine.mb) throw new Error('The Pro recording engine is not ready');
    this.stream = stream;
    this.options = options;
    this.state = 'inactive';
    this.videoBitsPerSecond = options.videoBitsPerSecond;
    this.audioBitsPerSecond = options.audioBitsPerSecond;
    this.ondataavailable = null; this.onstop = null; this.onerror = null;
    this._listeners = {};
    this._parts = []; this._pendingBytes = 0; this._written = 0;
    this._timer = null; this._wantPaused = false; this._stopRequested = false; this._finished = false;
    this._codec = proEngineCodec(options.format, options.codec);
    this.mimeType = proEngineMime(options.format, options.codec);
  }

  addEventListener(name, fn, options) { (this._listeners[name] ||= []).push({ fn, once: !!(options && options.once) }); }
  removeEventListener(name, fn) { this._listeners[name] = (this._listeners[name] || []).filter(item => item.fn !== fn); }
  _emit(name, event = {}) {
    const list = this._listeners[name] || [];
    for (const item of [...list]) { if (item.once) list.splice(list.indexOf(item), 1); item.fn(event); }
    const handler = this['on' + name];
    if (typeof handler === 'function') handler.call(this, event);
  }

  start(timeslice = 0) {
    if (this.state !== 'inactive') throw new DOMException('The recorder has already been started', 'InvalidStateError');
    this.state = 'recording';
    this._timeslice = timeslice;
    this._ready = this._init().then(() => {
      this._applyPause();
      this._emit('start');
      if (this._timeslice && !this._stopRequested) this._timer = setInterval(() => this._flush(), this._timeslice);
    }).catch(error => this._fail(error));
  }

  async _init() {
    const mb = proEngine.mb;
    const videoTrack = this.stream.getVideoTracks()[0];
    const audioTrack = this.stream.getAudioTracks()[0];
    if (!videoTrack) throw new Error('No video track to record');
    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 1 }),
      target: new mb.StreamTarget(new WritableStream({ write: chunk => this._write(chunk) }))
    });
    this.output = output;
    this.videoSource = new mb.MediaStreamVideoTrackSource(videoTrack, {
      codec: this._codec,
      bitrate: this.videoBitsPerSecond,
      keyFrameInterval: PRO_KEYFRAME_SECONDS,
      latencyMode: 'realtime',
      sizeChangeBehavior: 'contain'
    });
    output.addVideoTrack(this.videoSource);
    if (audioTrack && proEngine.audioCodec) {
      this.audioSource = new mb.MediaStreamAudioTrackSource(audioTrack, { codec: proEngine.audioCodec, bitrate: this.audioBitsPerSecond || 128000 });
      output.addAudioTrack(this.audioSource);
    }
    await output.start();
    for (const source of [this.videoSource, this.audioSource]) {
      if (source && source.errorPromise) source.errorPromise.catch(error => this._fail(error));
    }
  }

  _write(chunk) {
    // Fragmented MP4 is written strictly in order; anything else would make chunk concatenation invalid.
    if (chunk.position !== this._written) throw new Error(`Out-of-order write at ${chunk.position}, expected ${this._written}`);
    const copy = chunk.data.slice();
    this._parts.push(copy); this._pendingBytes += copy.byteLength; this._written += copy.byteLength;
  }

  _flush() {
    if (!this._pendingBytes) return;
    const data = new Blob(this._parts, { type: this.mimeType });
    this._parts = []; this._pendingBytes = 0;
    this._emit('dataavailable', { data });
  }

  _applyPause() {
    for (const source of [this.videoSource, this.audioSource]) {
      if (!source) continue;
      if (this._wantPaused && !source.paused) source.pause();
      else if (!this._wantPaused && source.paused) source.resume();
    }
  }

  pause() {
    if (this.state !== 'recording') throw new DOMException('Not recording', 'InvalidStateError');
    this.state = 'paused'; this._wantPaused = true; this._applyPause();
  }
  resume() {
    if (this.state !== 'paused') throw new DOMException('Not paused', 'InvalidStateError');
    this.state = 'recording'; this._wantPaused = false; this._applyPause();
  }
  requestData() { this._flush(); }

  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this._stopRequested = true;
    // If init is still running, the file is finished as soon as the output exists.
    this._ready.then(() => { if (!this._finished && !this._failed) return this._finish(); });
  }

  async _finish() {
    if (this._finished) return;
    this._finished = true;
    clearInterval(this._timer);
    try { await this.output.finalize(); } catch (error) { this._fail(error, true); }
    this._flush();
    this._emitStop();
  }

  _emitStop() {
    if (this._stopEmitted) return;
    this._stopEmitted = true;
    this._emit('stop');
  }

  _fail(error, alreadyFinishing = false) {
    if (this._failed) return;
    this._failed = true;
    this.error = error;
    clearInterval(this._timer);
    this.state = 'inactive';
    this._emit('error', { error });
    // MediaRecorder always follows an error with a stop event; recorder.js relies on that to save what exists.
    this._flush();
    if (!alreadyFinishing) this._emitStop();
    if (!alreadyFinishing) { try { this.output && this.output.cancel && this.output.cancel(); } catch { /* best effort */ } }
  }
}

if (typeof window !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) probeProEngine();
