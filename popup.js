document.querySelector('#open').addEventListener('click', async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('recorder.html') });
  window.close();
});
