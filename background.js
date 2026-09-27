chrome.commands.onCommand.addListener((command) => chrome.runtime.sendMessage({ type: command }).catch(() => {}));
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'recording-state') {
    chrome.action.setBadgeText({ text: message.active ? 'REC' : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#c21f3a' });
  }
  if (message.type === 'pointer-event' && sender.tab) chrome.runtime.sendMessage(message).catch(() => {});
});
