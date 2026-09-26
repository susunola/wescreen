const startButton = document.querySelector('#start');
const stopButton = document.querySelector('#stop');
const audioOption = document.querySelector('#audio');
const status = document.querySelector('#status');

let stream;
let recorder;
let chunks = [];
let startedAt;
let timer;

function setStatus(message, recording = false) {
  status.textContent = message;
  status.classList.toggle('recording', recording);
}

function formatElapsed(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function preferredMimeType() {
  return ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find((type) => MediaRecorder.isTypeSupported(type));
}

async function startRecording() {
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 60 } },
      audio: audioOption.checked
    });
    const mimeType = preferredMimeType();
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = [];
    recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); });
    recorder.addEventListener('stop', saveRecording, { once: true });
    stream.getVideoTracks()[0].addEventListener('ended', () => { if (recorder?.state === 'recording') recorder.stop(); }, { once: true });
    recorder.start(1000);
    startedAt = Date.now();
    timer = setInterval(() => setStatus(`正在录制 · ${formatElapsed(Date.now() - startedAt)}`, true), 500);
    startButton.disabled = true;
    stopButton.disabled = false;
    audioOption.disabled = true;
  } catch (error) {
    setStatus(error.name === 'NotAllowedError' ? '未开始：你取消了屏幕选择。' : `无法开始录制：${error.message}`);
  }
}

function stopRecording() {
  if (recorder?.state === 'recording') recorder.stop();
}

function saveRecording() {
  clearInterval(timer);
  stream?.getTracks().forEach((track) => track.stop());
  const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = `edge-screen-recording-${stamp}.webm`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(`录制已保存 · 时长 ${formatElapsed(Date.now() - startedAt)}`);
  startButton.disabled = false;
  stopButton.disabled = true;
  audioOption.disabled = false;
}

startButton.addEventListener('click', startRecording);
stopButton.addEventListener('click', stopRecording);
