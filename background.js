chrome.commands.onCommand.addListener((command) => chrome.runtime.sendMessage({ type: command }).catch(() => {}));
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'recording-state') {
    chrome.action.setBadgeText({ text: message.active ? 'REC' : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#c21f3a' });
  }
});
