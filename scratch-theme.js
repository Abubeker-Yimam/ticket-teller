const fs = require('fs');

// Update index.html to add theme toggle

let indexHtml = fs.readFileSync('public/index.html', 'utf8');

const themeToggleHTML = `
      <div style="margin-top: auto; padding-top: 20px;">
        <a href="#" class="nav-item" onclick="toggleTheme(event)">
          <span class="nav-icon" id="theme-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="5"/>
              <path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>
            </svg>
          </span>
          <span id="theme-text">Theme</span>
        </a>
`;

indexHtml = indexHtml.replace(
  '<div style="margin-top: auto; padding-top: 20px;">',
  themeToggleHTML
);

// Update sound ping
indexHtml = indexHtml.replace(
  '<audio id="chat-ping-sound" src="https://cdn.pixabay.com/download/audio/2021/08/04/audio_0625c1539c.mp3?filename=message-incoming-132057.mp3" preload="auto"></audio>',
  '<audio id="sys-notification-sound" src="https://cdn.pixabay.com/download/audio/2021/08/04/audio_3d1efdf771.mp3?filename=notification-11231.mp3" preload="auto"></audio>\n  <audio id="chat-ping-sound" src="https://cdn.pixabay.com/download/audio/2021/08/09/audio_820c7857ec.mp3?filename=positive-notification-102008.mp3" preload="auto"></audio>'
);

fs.writeFileSync('public/index.html', indexHtml);
console.log("Updated index.html");
