chrome.commands.onCommand.addListener((command) => chrome.runtime.sendMessage({ type: command }).catch(() => {}));
let highlightGeneration = 0;
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'recording-state') return;
  const generation = ++highlightGeneration;
  chrome.action.setBadgeText({ text: message.active ? 'REC' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#c21f3a' });
  // The highlight is drawn in the captured tab itself, not in the recorder tab's
  // canvas. This keeps the screen video track independent of tab visibility.
  chrome.storage.session.get('pointerTargetTabId').then(({ pointerTargetTabId }) => {
    if (generation !== highlightGeneration) return;
    if (pointerTargetTabId != null) chrome.tabs.sendMessage(pointerTargetTabId, {
      type: 'click-highlights-state', active: Boolean(message.active && message.highlightClicks)
    }).catch(() => {});
  }).catch(() => {});
});
