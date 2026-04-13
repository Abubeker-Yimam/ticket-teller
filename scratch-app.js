const fs = require('fs');

let appJs = fs.readFileSync('public/js/app.js', 'utf8');

// Add theme toggling to app.js
const themeLogic = `
// ── Theme & Notifications ──────────────────────────────────────────────
function toggleTheme(e) {
  if (e) e.preventDefault();
  const root = document.documentElement;
  const isLight = root.classList.contains('light-theme');
  if (isLight) {
    root.classList.remove('light-theme');
    localStorage.setItem('theme', 'dark');
    document.getElementById('theme-icon').innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>';
    document.getElementById('theme-text').textContent = 'Dark Theme';
  } else {
    root.classList.add('light-theme');
    localStorage.setItem('theme', 'light');
    document.getElementById('theme-icon').innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    document.getElementById('theme-text').textContent = 'Light Theme';
  }
}

function applySavedTheme() {
  const saved = localStorage.getItem('theme');
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  if (saved === 'light' || (!saved && prefersLight)) {
    toggleTheme(null);
  }
}

function playSysNotification() {
  const audio = document.getElementById('sys-notification-sound');
  if (audio && (!window.chatState || !window.chatState.muted)) {
    audio.currentTime = 0;
    audio.play().catch(e => console.log('Audio autoplay blocked', e));
  }
}

`;

appJs = appJs.replace(
  '// ── UI Actions ─────────────────────────────────────────────',
  themeLogic + '// ── UI Actions ─────────────────────────────────────────────'
);

appJs = appJs.replace(
  '// 3. UI Customization (Admin vs Partner)',
  `applySavedTheme();\n\n  // 3. UI Customization (Admin vs Partner)`
);

// Add system notification sound hook on feed refresh where events increased
appJs = appJs.replace(
  `state.lastEventCount = state.events.length;`,
  `if (state.events.length > state.lastEventCount && state.lastEventCount > 0) {
      playSysNotification();
  }
  state.lastEventCount = state.events.length;`
);

fs.writeFileSync('public/js/app.js', appJs);
console.log("Updated app.js");
