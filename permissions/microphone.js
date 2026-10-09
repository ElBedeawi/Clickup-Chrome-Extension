import { isSidebar } from '../lib/platform.js';

const button = document.getElementById('grant');
const status = document.getElementById('status');

document.getElementById('firefox-note').hidden = !isSidebar();

function showStatus(message, kind) {
  status.textContent = message;
  status.className = `notice ${kind}`;
  status.hidden = false;
}

async function request() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    button.hidden = true;
    showStatus('Microphone allowed. You can close this tab and record again from the side panel.', 'success');
    // Tell an open panel to re-read the device list (its permission status may not fire on every browser).
    chrome.storage.session.set({ micGrantedAt: Date.now() }).catch(() => {});
  } catch (err) {
    showStatus(
      `Microphone access was not granted (${err.name}). If you blocked it before, click the icon at the ` +
        'left of the address bar, set Microphone to "Allow", then try again.',
      'error',
    );
  }
}

button.addEventListener('click', request);
