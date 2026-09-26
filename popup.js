const t = (key, fallback) => {
  try { return chrome.i18n.getMessage(key) || fallback; } catch { return fallback; }
};
document.querySelector('#lead').textContent = t('popupLead', '选择录制范围并保存视频。');
document.querySelector('#privacy').textContent = t('popupPrivacy', '无账号 · 无上传 · 无追踪：录像只保存在这台设备上。');
document.querySelector('#open').textContent = t('popupOpen', '打开录制器');
document.querySelector('#open').addEventListener('click', async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('recorder.html') });
  window.close();
});
