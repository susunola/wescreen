// Injected only after the user invokes WeScreen on the current tab.
// Draw the click ring in the shared page so the original display track can be
// recorded directly; a canvas in the background recorder tab can stop repainting.
if (!globalThis.__wescreenPointerTracker) {
  globalThis.__wescreenPointerTracker = true;
  let active = false;
  let overlay = null;

  function removeOverlay() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'click-highlights-state') return;
    active = Boolean(message.active);
    if (!active) removeOverlay();
  });

  addEventListener('pointerdown', (event) => {
    if (!active || !document.documentElement) return;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden;';
      document.documentElement.append(overlay);
    }
    const ring = document.createElement('span');
    const radius = Math.max(15, innerWidth * .018);
    ring.style.cssText = `position:absolute;left:${event.clientX}px;top:${event.clientY}px;width:${radius * 2}px;height:${radius * 2}px;border-radius:50%;background:rgba(255,69,82,.7);transform:translate(-50%,-50%) scale(1);opacity:1;pointer-events:none;transition:transform .65s ease-out,opacity .65s ease-out;`;
    overlay.append(ring);
    requestAnimationFrame(() => {
      ring.style.transform = 'translate(-50%,-50%) scale(2.5)';
      ring.style.opacity = '0';
    });
    setTimeout(() => ring.remove(), 750);
  }, { capture: true, passive: true });
}
