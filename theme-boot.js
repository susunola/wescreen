// Applies the saved appearance before first paint so the page never flashes the wrong theme.
try { if (localStorage.getItem('wescreen-theme') === 'light') document.documentElement.dataset.theme = 'light'; } catch { /* storage unavailable */ }
