// Recording-first interface: the three settings that decide file size and sharpness become one choice
// ("画质与体积"), with the expected size shown live. Everything else stays reachable but folded away.
// This only builds controls on top of the existing form; the original selects keep their ids and events,
// so persistence, the recorder and every other script keep working untouched.
(() => {
  const PRESETS = [
    { id: 'lecture', quality: 'compact', content: 'detail', fps: 24, zh: ['文字优先', '课程、代码、PPT · 最小体积'], en: ['Text first', 'Courses, code, slides · smallest files'] },
    { id: 'balanced', quality: 'compact', content: 'auto', fps: 30, zh: ['均衡', '日常演示与会议'], en: ['Balanced', 'Everyday demos and meetings'] },
    { id: 'motion', quality: 'standard', content: 'motion', fps: 30, zh: ['运动画面', '游戏、视频 · 流畅优先'], en: ['Motion', 'Games and video · smoothest'] }
  ];
  const FORMATS = [
    { value: 'av1mp4', label: 'AV1', zh: '体积最小，Chrome / Edge / Firefox 可直接播放。', en: 'Smallest files. Plays in Chrome, Edge and Firefox.' },
    { value: 'hevc', label: 'HEVC', zh: '体积小，Safari、Edge 与新版 Chrome 可播放。', en: 'Small files. Plays in Safari, Edge and recent Chrome.' },
    { value: 'mp4', label: 'H.264', zh: '兼容性最好，任何设备都能播放，体积较大。', en: 'Plays everywhere. Larger files.' },
    { value: 'vp9', label: 'VP9', zh: 'WebM 格式，画质优先，适合网页和 Chrome 系浏览器。', en: 'WebM. Quality first, for the web and Chromium browsers.' }
  ];
  const text = (zh, en) => (typeof E === 'function' ? E(zh, en) : zh);
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children) node.append(child);
    return node;
  };

  // studio-ui.js (loaded just before this file) has already split the page into a stage and a settings column.
  const form = document.querySelector('.studio-record-settings');
  const grid = form && form.querySelector('.record-quality-grid');
  const start = document.getElementById('start');
  if (!form || !grid || !start) return;

  // Estimated bytes from the same bitrate rules the recorder uses, evaluated for a given preset without side effects.
  function estimateMbPerMinute(quality, content, fps) {
    const qualitySelect = $('quality'), contentSelect = $('capture-content');
    const previous = [qualitySelect.value, contentSelect.value];
    qualitySelect.value = quality; contentSelect.value = content;
    try {
      const height = Number($('resolution').value) || 1080, width = Math.round(height * 16 / 9);
      const live = typeof displayStream !== 'undefined' && displayStream?.getVideoTracks()[0];
      const track = live || { getSettings: () => ({ width, height, frameRate: fps || Number($('framerate').value) || 30 }) };
      return (videoBitrate(track) + captureAudioBitrate()) * 60 / 8 / 1e6;
    } finally { qualitySelect.value = previous[0]; contentSelect.value = previous[1]; }
  }

  const presetButtons = PRESETS.map(preset => {
    const button = el('button', { type: 'button', className: 'v2-preset' });
    button.dataset.preset = preset.id;
    button.append(el('span', { className: 'v2-dot', ariaHidden: 'true' }), el('span', { className: 'v2-preset-copy' }, el('strong'), el('small')), el('span', { className: 'v2-preset-size' }));
    button.addEventListener('click', () => {
      const profile = $('capture-profile');
      if (profile) { profile.value = preset.id; profile.dispatchEvent(new Event('change')); }
      else { $('quality').value = preset.quality; $('capture-content').value = preset.content; $('quality').dispatchEvent(new Event('change')); persist(); }
      refresh();
    });
    return button;
  });

  const numberEl = el('span', { className: 'v2-number' }), perHourEl = el('p', { className: 'v2-hour' });
  const meter = el('div', { className: 'v2-meter' }, el('span'));
  const estimate = el('div', { className: 'v2-estimate' }, el('div', { className: 'v2-estimate-row' }, numberEl, el('span', { className: 'v2-unit' })), perHourEl, meter);

  const formatButtons = FORMATS.map(format => {
    const button = el('button', { type: 'button', className: 'v2-chip', textContent: format.label });
    button.dataset.format = format.value;
    button.addEventListener('click', () => {
      if (button.disabled) return;
      $('format').value = format.value;
      // Prefer the browser's own encoder; fall back to the WebCodecs engine only where it is the one that can do it.
      const native = FORMAT_TYPES[format.value]?.some(type => MediaRecorder.isTypeSupported(type));
      if ($('engine')) $('engine').value = !native && format.value !== 'vp9' ? 'pro' : 'standard';
      for (const id of ['format', 'engine']) $(id).dispatchEvent(new Event('change'));
      persist(); refresh();
    });
    return button;
  });
  const formatNote = el('p', { className: 'hint v2-format-note' });

  const side = el('section', { className: 'v2-quality', ariaLabel: text('画质与体积', 'Quality and size') },
    el('h3', { className: 'v2-title' }), el('div', { className: 'v2-presets' }, ...presetButtons), estimate,
    el('h3', { className: 'v2-title v2-format-title' }), el('div', { className: 'v2-chips' }, ...formatButtons), formatNote);

  // Everything that used to be the front page of settings now lives behind one disclosure.
  const details = el('details', { className: 'advanced v2-fine' }, el('summary'));
  const summary = details.querySelector('summary');
  const filenameLabel = $('filename').closest('label');
  const helpNotes = ['record-summary', 'capture-resolution-help'].map(id => document.getElementById(id)).filter(Boolean);
  details.append(grid, ...helpNotes);
  // Order: the quality decision, the sound options, the file name, the folded fine settings, then the action.
  const title = form.querySelector('.studio-settings-title');
  const options = form.querySelector('.record-options');
  const advanced = document.getElementById('record-advanced');
  const startRow = start.closest('.capture-start-row');
  if (title) title.after(side); else form.prepend(side);
  side.after(...[options, filenameLabel, details, advanced].filter(Boolean));
  if (startRow) { startRow.classList.add('v2-start-row'); form.append(startRow); }

  function currentPreset() {
    const quality = $('quality').value, content = $('capture-content').value;
    return PRESETS.find(preset => preset.quality === quality && preset.content === content)?.id || null;
  }
  function refresh() {
    side.querySelectorAll('.v2-title')[0].textContent = text('画质与体积', 'Quality and size');
    side.querySelector('.v2-format-title').textContent = text('格式', 'Format');
    summary.textContent = text('更多画质与编码设置', 'More quality and encoder settings');
    const selected = currentPreset();
    const sizes = PRESETS.map(preset => estimateMbPerMinute(preset.quality, preset.content, preset.fps));
    PRESETS.forEach((preset, index) => {
      const button = presetButtons[index];
      button.querySelector('strong').textContent = text(preset.zh[0], preset.en[0]);
      button.querySelector('small').textContent = text(preset.zh[1], preset.en[1]);
      button.querySelector('.v2-preset-size').textContent = '≈ ' + Math.round(sizes[index]) + ' MB/' + text('分', 'min');
      button.setAttribute('aria-pressed', String(selected === preset.id));
    });
    const mb = estimateMbPerMinute($('quality').value, $('capture-content').value);
    numberEl.textContent = String(Math.round(mb));
    side.querySelector('.v2-unit').textContent = 'MB / ' + text('分钟', 'min');
    perHourEl.textContent = text('录 1 小时约 ', 'One hour is about ') + (mb * 60 / 1000).toFixed(1) + ' GB · ' + text('按目标码率估算，实际取决于画面内容', 'estimated from the target bitrate; real size depends on the content');
    meter.firstChild.style.width = Math.min(100, Math.round(mb / Math.max(...sizes, mb) * 100)) + '%';
    const current = $('format').value;
    formatButtons.forEach((button, index) => {
      const option = $('format').querySelector('[value="' + FORMATS[index].value + '"]');
      button.disabled = !option || option.disabled;
      button.setAttribute('aria-pressed', String(current === FORMATS[index].value));
      button.title = button.disabled ? text('此浏览器无法编码该格式', 'This browser cannot encode this format') : '';
    });
    const chosen = FORMATS.find(format => format.value === current);
    formatNote.textContent = chosen ? text(chosen.zh, chosen.en) : '';
  }

  for (const id of ['resolution', 'quality', 'framerate', 'capture-content', 'capture-audio-quality', 'format', 'engine']) $(id)?.addEventListener('change', refresh);
  for (const event of ['wescreen-capture-settings', 'wescreen-language']) window.addEventListener(event, refresh);
  refresh();
  // Settings are restored asynchronously; follow them once they land.
  setTimeout(refresh, 400);
  setTimeout(refresh, 1500);

  // Appearance: dark by default, light on request. Stored per browser, applied before the first paint on later loads.
  const themeButton = el('button', { type: 'button', className: 'quiet v2-theme', id: 'theme-toggle' });
  const applyTheme = theme => {
    document.documentElement.dataset.theme = theme;
    themeButton.textContent = theme === 'light' ? text('深色', 'Dark') : text('浅色', 'Light');
    themeButton.setAttribute('aria-label', theme === 'light' ? text('切换到深色外观', 'Switch to dark appearance') : text('切换到浅色外观', 'Switch to light appearance'));
  };
  let theme = 'dark';
  try { theme = localStorage.getItem('wescreen-theme') === 'light' ? 'light' : 'dark'; } catch { /* storage can be unavailable */ }
  applyTheme(theme);
  themeButton.addEventListener('click', () => {
    theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('wescreen-theme', theme); } catch { /* best effort */ }
    applyTheme(theme);
  });
  window.addEventListener('wescreen-language', () => applyTheme(document.documentElement.dataset.theme || 'dark'));
  (document.querySelector('.app > header .header-actions') || document.querySelector('.app > header'))?.prepend(themeButton);
})();
