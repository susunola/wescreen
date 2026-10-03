const t = (key, fallback) => {
  try { return chrome.i18n.getMessage(key) || fallback; } catch { return fallback; }
};
document.querySelector('#lead').textContent = t('popupLead', '选择录制范围并保存视频。');
document.querySelector('#privacy').textContent = t('popupPrivacy', '无账号 · 无上传 · 无追踪：录像只保存在这台设备上。');
document.querySelector('#open').textContent = t('popupOpen', '打开录制器');
document.querySelector('#open').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && /^https?:/i.test(tab.url || '')) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['pointer-tracker.js'] });
      await chrome.storage.session.set({ pointerTargetTabId: tab.id });
    } else await chrome.storage.session.remove('pointerTargetTabId');
  } catch {
    // Protected pages cannot host the highlight overlay; screen recording still works.
    await chrome.storage.session.remove('pointerTargetTabId').catch(() => {});
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL('recorder.html') });
  window.close();
});

const urlInput = document.querySelector('#record-url');
document.querySelector('#open-link').addEventListener('click', async () => {
  let url = urlInput.value.trim();
  if (!url) return urlInput.focus();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const target = new URL(url);
    await chrome.storage.local.set({ pendingLink: target.href, filenameSuggestion: target.hostname.replace(/^www\./, '') });
    await chrome.tabs.create({ url: target.href });
    window.close();
  } catch {
    urlInput.setCustomValidity('Enter a valid http(s) URL.');
    urlInput.reportValidity();
  }
});
urlInput.addEventListener('input', () => urlInput.setCustomValidity(''));
