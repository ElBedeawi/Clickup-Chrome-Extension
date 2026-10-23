// Full-size view of a pending attachment in a normal tab. The side panel / sidebar can't go
// fullscreen (the browser refuses the Fullscreen API there), so the panel sends the user here.
// Opened as viewer.html?id=<IndexedDB record id>; the file is read back from IndexedDB.
import { getAttachment } from '../lib/attachments-db.js';
import { getPrefs, setPrefs } from '../lib/storage.js';
import { hydrateLinks } from '../lib/links.js';

hydrateLinks();

const main = document.getElementById('main');

function fail(message) {
  const p = document.createElement('p');
  p.className = 'notice info';
  p.textContent = message;
  main.replaceChildren(p);
  document.querySelector('.hint').hidden = true; // nothing pending to talk about
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const SPEEDS = [1, 1.5, 2];

/**
 * 1× / 1.5× / 2× for checking a long clip before uploading. The last choice is remembered in
 * prefs.viewer.speed. The browser's own controls can change the speed too, so the buttons follow
 * `ratechange`. Reading the saved speed never holds up the page (or fails it, without storage).
 */
function setUpSpeed(video) {
  const group = document.getElementById('speed');
  const buttons = [...group.querySelectorAll('button')];
  const show = () => {
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === video.playbackRate)));
  };
  const apply = (speed) => {
    video.defaultPlaybackRate = speed;
    video.playbackRate = speed;
  };
  buttons.forEach((b) =>
    b.addEventListener('click', () => {
      const speed = Number(b.dataset.speed);
      apply(speed);
      setPrefs({ viewer: { speed } }).catch(() => {});
    }),
  );
  video.addEventListener('ratechange', show);
  group.hidden = false;
  show();
  (async () => {
    try {
      const speed = (await getPrefs()).viewer?.speed;
      if (SPEEDS.includes(speed) && speed !== 1) apply(speed);
    } catch {
      // No extension storage (e.g. the smoke test's plain page): stay at 1×.
    }
  })();
}

const id = Number(new URLSearchParams(location.search).get('id'));
let record = null;
try {
  record = id ? await getAttachment(id) : null;
} catch (err) {
  fail(`Could not read the attachment: ${err.message}`);
}

if (record?.file) {
  const { file } = record;
  document.title = `${file.name} — Video & Screenshot Uploader for ClickUp`;
  document.getElementById('name').textContent = file.name;
  document.getElementById('size').textContent = formatBytes(file.size);
  const url = URL.createObjectURL(file);
  const download = document.getElementById('download');
  download.href = url;
  download.download = file.name;
  download.hidden = false;
  if (file.type.startsWith('video/')) {
    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.autoplay = true;
    main.replaceChildren(video);
    setUpSpeed(video);
  } else if (file.type.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = file.name;
    main.replaceChildren(img);
  } else {
    fail('This file type has no preview. You can still download it.');
  }
} else if (!main.firstChild) {
  // IndexedDB answers undefined for a missing record (uploaded and removed, or a stale link).
  fail('This attachment is no longer available: it was uploaded or removed from the side panel.');
}
window.__ready = true; // the smoke test waits for this
