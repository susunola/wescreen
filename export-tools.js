// Library actions that hand a finished recording to the local helper for slow, constant-quality encoding:
// smaller files (HEVC / AV1 / VP9) and short GIF / animated WebP exports for chat and docs.
// The browser's real-time encoder is a rough first pass; the helper has time to do it properly.
// Results are downloaded directly; nothing is added to the library, so originals are never replaced.
const EXPORT_PRESETS = {
  hevc: { target: 'x265', quality: 'balanced', suffix: '-small', ext: 'mp4', zh: '缩小体积（HEVC，需本机增强包）', en: 'Shrink file size (HEVC, needs helper)', note: 'HEVC plays on Safari, Edge and recent Chrome; use H.264 or VP9 for older players.' },
  av1: { target: 'svtav1', quality: 'balanced', suffix: '-av1', ext: 'mp4', zh: '极限压缩（AV1，最小体积，需本机增强包）', en: 'Smallest file (AV1, needs helper)', note: 'AV1 is the smallest; it plays in Chrome, Edge and Firefox, but older Safari/QuickTime may not play it.' },
  gif: { target: 'gif', quality: 'balanced', suffix: '', ext: 'gif', zh: '导出 GIF（≤60 秒，需本机增强包）', en: 'Export GIF (≤60 s, needs helper)' },
  webp: { target: 'webp', quality: 'balanced', suffix: '', ext: 'webp', zh: '导出动态 WebP（≤60 秒，需本机增强包）', en: 'Export animated WebP (≤60 s, needs helper)' }
};

function exportFileName(name, preset) {
  const base = String(name || 'recording').replace(/\.(mp4|webm|mkv)$/i, '');
  return `${base}${preset.suffix}.${preset.ext}`;
}

async function helperExport(entry, presetKey, hooks = {}) {
  const preset = EXPORT_PRESETS[presetKey];
  const status = text => { if (hooks.status) hooks.status(text); };
  const health = await connectHelper();
  if (!Array.isArray(health?.optimize)) throw new Error(E('请更新并启动本机增强包以使用此功能。', 'Update and start the local helper to use this feature.'));
  if (!health.optimize.includes(preset.target)) throw new Error(E('本机 FFmpeg 不支持此格式：', 'The helper\'s FFmpeg cannot encode ') + preset.target);
  const blob = await readStore('videos', entry.id);
  if (!blob || !blob.size) throw new Error(L('errEmpty'));
  status(E('正在传入录像…', 'Sending recording to the helper…'));
  const upload = (await (await enhancementRequest('/uploads', { method: 'POST', body: blob })).json()).id;
  const created = await (await enhancementRequest('/jobs/optimize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ upload, target: preset.target, quality: preset.quality, name: entry.name, sourceId: entry.id }) })).json();
  let info;
  try {
    for (;;) {
      info = await (await enhancementRequest('/jobs/' + created.id)).json();
      if (info.state === 'done') break;
      if (info.state === 'error' || info.state === 'cancelled') throw new Error(info.error || E('转换失败。', 'Conversion failed.'));
      status(E('正在转换 ', 'Converting ') + Math.round((info.progress || 0) * 100) + '%');
      await (hooks.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))))(hooks.pollMs ?? 1000);
    }
    status(E('正在保存…', 'Saving…'));
    const result = await (await enhancementRequest(`/jobs/${created.id}/result`)).blob();
    const name = exportFileName(entry.name, preset);
    await download(new Blob([result], { type: info.mime || result.type }), name, null);
    const saved = info.savedRatio;
    status(E('已保存 ', 'Saved ') + name + ((presetKey === 'hevc' || presetKey === 'av1') && typeof saved === 'number' ? (saved >= 0 ? E('，体积减少 ', ' — ') + Math.round(saved * 100) + E('%', '% smaller') : E('，但比原文件更大，建议保留原文件', ' — larger than the original; keep the original')) : ''));
    return { name, size: result.size, info };
  } finally {
    // The helper keeps results until deleted; never leave a copy of the user's recording behind.
    enhancementRequest('/jobs/' + created.id, { method: 'DELETE' }).catch(() => {});
  }
}

async function selectedSingleRecording() {
  if (librarySelection.size !== 1) throw new Error(E('请选择一条录像。', 'Select one recording.'));
  const id = [...librarySelection][0];
  const entries = (await readStore('recordings')).filter(entry => !entry.deletedAt);
  const group = recordingGroups(entries).find(entry => entry.id === id);
  if (group?._parts && group._parts.length > 1) throw new Error(E('这是分段录像，请先合并。', 'This recording has several parts; merge it first.'));
  const entry = (group?._parts && group._parts[0]) || entries.find(item => item.id === id);
  if (!entry) throw new Error(E('找不到录像。', 'Recording not found.'));
  return entry;
}

if (typeof libraryAction === 'function' && typeof document !== 'undefined') {
  for (const key of Object.keys(EXPORT_PRESETS)) {
    const preset = EXPORT_PRESETS[key];
    libraryAction('library-export-' + key, preset.zh, preset.en, async () => {
      const entry = await selectedSingleRecording();
      await helperExport(entry, key, { status: text => { $('library-status').textContent = text; } });
    });
  }
}
