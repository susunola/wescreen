// Injected only after the user invokes WeScreen on the current tab.
if (!globalThis.__wescreenPointerTracker) {
  globalThis.__wescreenPointerTracker = true;
  addEventListener('pointerdown', (event) => {
    chrome.runtime.sendMessage({
      type: 'pointer-event',
      x: event.clientX / Math.max(1, innerWidth),
      y: event.clientY / Math.max(1, innerHeight),
      at: Date.now()
    }).catch(() => {});
  }, { capture: true, passive: true });
}
