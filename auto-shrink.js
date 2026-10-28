// Optional post-recording slimming. When the local helper is running, a finished recording is re-encoded in the
// background at constant quality (AV1 with screen-content tools, or HEVC) and the smaller copy is added to the
// library next to the original. Nothing is replaced or deleted, and a result that is not clearly smaller is dropped.
// Same durable-queue shape as smart-tail.js, so a closed tab or a busy helper just means "try again later".
const SHRINK_MIN_SAVING = 0.15;
const shrinkEnabled = proControl('auto-shrink', '录完自动瘦身（需本机增强包，另存更小的副本，原录像保留）', 'Shrink after recording (needs helper; saves a smaller copy, original kept)', 'checkbox');
const shrinkTarget = (() => {
  const label = document.createElement('label'), span = document.createElement('span'), select = document.createElement('select');
  span.textContent = E('瘦身格式', 'Shrink format'); select.id = 'auto-shrink-target';
  for (const [value, zh, en] of [['svtav1', 'AV1（最小）', 'AV1 (smallest)'], ['x265', 'HEVC（兼容性更好）', 'HEVC (wider playback)']]) select.append(new Option(E(zh, en), value));
  label.append(span, select); return label;
})();
captureProGrid.append(shrinkEnabled, shrinkTarget);
SETTING_FIELDS.push(['auto-shrink', 'checked'], ['auto-shrink-target', 'value']);
for (const id of ['auto-shrink', 'auto-shrink-target']) $(id).addEventListener('change', persist);
const shrinkStatus = document.createElement('p'); shrinkStatus.id = 'auto-shrink-status'; shrinkStatus.className = 'hint'; shrinkStatus.setAttribute('role', 'status'); $('result').append(shrinkStatus);
const shrinkQueueKey = 'auto-shrink-pending'; let shrinking = false;

// Pure choice of encoder and effort so it can be tested: prefer the user's pick, fall back to HEVC, never guess a missing encoder.
function shrinkPlan(health, preferred, durationMs) {
  const available = Array.isArray(health && health.optimize) ? health.optimize : [];
  const target = [preferred, 'x265'].find(name => available.includes(name));
  if (!target) return null;
  const long = durationMs > 10 * 60000;
  return { target, quality: 'balanced', effort: long ? 'fast' : 'balanced' };
}

async function mutateShrinkQueue(change) {
  return runTx('meta', 'readwrite', tx => { const store = tx.objectStore('meta'), request = store.get(shrinkQueueKey); request.onsuccess = () => store.put(change(request.result || []), shrinkQueueKey); });
}
async function queueAutoShrink(id) {
  const entry = (await readStore('recordings')).find(item => item.id === id && !item.deletedAt);
  if (!entry || entry.enhancement === 'optimize') return;
  await mutateShrinkQueue(queue => queue.some(item => item.sourceId === id) ? queue : [...queue, { sourceId: id, target: $('auto-shrink-target').value, createdAt: Date.now() }]);
  shrinkStatus.textContent = helperHealth?.optimize ? E('瘦身已排队，原录像可继续使用。', 'Shrink queued. The original stays available.') : E('瘦身等待本机增强包连接；原录像已保存。', 'Shrink is waiting for the helper; the original is saved.');
  processShrinkQueue().catch(error => { shrinkStatus.textContent = error.message; });
}
async function processShrinkQueue() {
  if (shrinking || !helperHealth?.optimize) return;
  shrinking = true;
  try {
    await navigator.locks.request('wescreen-auto-shrink', { ifAvailable: true }, async lock => {
      if (!lock) return;
      const queue = await readStore('meta', shrinkQueueKey) || [], item = queue.find(i => !i.error);
      if (!item) return;
      const drop = () => mutateShrinkQueue(items => items.filter(i => i.sourceId !== item.sourceId));
      const entry = (await readStore('recordings')).find(e => e.id === item.sourceId && !e.deletedAt);
      if (!entry) return drop();
      try {
        let task = item.jobId ? await readStore('tasks', item.jobId) : null;
        if (!task) {
          const plan = shrinkPlan(helperHealth, item.target, entry.duration);
          if (!plan) throw new Error(E('本机 FFmpeg 缺少 AV1/HEVC 编码器。', 'The helper\'s FFmpeg has no AV1 or HEVC encoder.'));
          const blob = await readStore('videos', entry.id);
          if (!blob || !blob.size) throw new Error(L('errEmpty'));
          const upload = (await (await enhancementRequest('/uploads', { method: 'POST', body: blob })).json()).id;
          const created = await (await enhancementRequest('/jobs/optimize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ upload, ...plan, name: entry.name, sourceId: entry.id, batchRef: 'auto-shrink:' + entry.id, screenContent: entry.captureContent !== 'motion' }) })).json();
          task = { id: created.id, mode: 'optimize', target: plan.target, sourceId: entry.id, name: entry.name, createdAt: Date.now() };
          await runTx('tasks', 'readwrite', tx => tx.objectStore('tasks').put(task));
          await mutateShrinkQueue(items => items.map(i => i.sourceId === item.sourceId ? { ...i, jobId: task.id } : i));
        }
        const info = await (await enhancementRequest('/jobs/' + task.id)).json();
        if (info.state === 'error' || info.state === 'cancelled') throw new Error(info.error || L('jobCancelled'));
        if (info.state !== 'done') { shrinkStatus.textContent = E('正在瘦身 ', 'Shrinking ') + Math.round((info.progress || 0) * 100) + E('%，原录像保留。', '%. Original kept.'); return; }
        const smaller = typeof info.savedRatio === 'number' && info.savedRatio >= SHRINK_MIN_SAVING;
        const savedId = smaller ? await saveTaskResult({ ...task, ...info }) : null;
        await drop();
        enhancementRequest('/jobs/' + task.id, { method: 'DELETE' }).catch(() => {});
        shrinkStatus.textContent = savedId ? E('已存入更小的副本，体积减少 ', 'Smaller copy saved, ') + Math.round(info.savedRatio * 100) + E('%；原录像保留。', '% smaller. Original kept.') : E('瘦身收益不明显，已保留原录像。', 'Not clearly smaller; kept the original only.');
      } catch (error) {
        if (/Another.*running|busy|HTTP 409|Failed to fetch|fetch failed/.test(error.message)) { shrinkStatus.textContent = E('瘦身等待本机程序空闲或恢复连接。', 'Shrink is waiting for the helper to be free or reconnect.'); return; }
        await mutateShrinkQueue(items => items.map(i => i.sourceId === item.sourceId ? { ...i, error: error.message } : i));
        shrinkStatus.textContent = E('瘦身未完成，原录像保留：', 'Shrink incomplete; original kept: ') + error.message;
      }
    });
  } finally { shrinking = false; }
}
const shrinkTimer = setInterval(() => processShrinkQueue().catch(error => { shrinkStatus.textContent = error.message; }), 4000);
window.addEventListener('pagehide', () => clearInterval(shrinkTimer));
