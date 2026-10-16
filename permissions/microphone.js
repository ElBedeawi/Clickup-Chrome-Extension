// One-time device permission helper. Side panels / sidebars can't show the browser's
// microphone or camera prompt, but a normal extension tab can, and the grant then applies to
// the whole extension origin (including the recorder's page). Which device is asked for comes
// from the URL: permissions/microphone.html?device=microphone|camera.
import { isSidebar } from '../lib/platform.js';

const DEVICES = {
  microphone: {
    constraints: { audio: true },
    grantedKey: 'micGrantedAt',
    title: 'Microphone access — Uploader for ClickUp',
    heading: 'Microphone access',
    intro:
      "The browser can't show the microphone prompt inside the side panel. Allow it here once and " +
      'recordings in the side panel will include your voice.',
    button: 'Allow microphone',
    granted: 'Microphone allowed. You can close this tab and record again from the side panel.',
    denied: (name) =>
      `Microphone access was not granted (${name}). If you blocked it before, click the icon at the ` +
      'left of the address bar, set Microphone to "Allow", then try again.',
  },
  camera: {
    constraints: { video: true },
    grantedKey: 'cameraGrantedAt',
    title: 'Camera access — Uploader for ClickUp',
    heading: 'Camera access',
    intro:
      "The browser can't show the camera prompt inside the side panel. Allow it here once and " +
      'you can add yourself to recordings as a small camera bubble.',
    button: 'Allow camera',
    granted: 'Camera allowed. You can close this tab and pick your camera in the side panel.',
    denied: (name) =>
      `Camera access was not granted (${name}). If you blocked it before, click the icon at the ` +
      'left of the address bar, set Camera to "Allow", then try again.',
  },
};

const device = DEVICES[new URLSearchParams(location.search).get('device')] || DEVICES.microphone;

const button = document.getElementById('grant');
const status = document.getElementById('status');

document.title = device.title;
document.getElementById('heading').textContent = device.heading;
document.getElementById('intro').textContent = device.intro;
button.textContent = device.button;
document.getElementById('firefox-note').hidden = !isSidebar();

function showStatus(message, kind) {
  status.textContent = message;
  status.className = `notice ${kind}`;
  status.hidden = false;
}

async function request() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(device.constraints);
    stream.getTracks().forEach((t) => t.stop());
    button.hidden = true;
    showStatus(device.granted, 'success');
    // Tell an open panel to re-read the device list (its permission status may not fire on every browser).
    chrome.storage.session.set({ [device.grantedKey]: Date.now() }).catch(() => {});
  } catch (err) {
    showStatus(device.denied(err.name), 'error');
  }
}

button.addEventListener('click', request);
