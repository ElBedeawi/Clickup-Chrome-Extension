// Runs as a service worker in Chrome and as an event page in Firefox (manifest derived by
// scripts/lib/firefox-manifest.mjs). Classic script: no imports, nothing kept in memory.

// Clicking the toolbar icon opens the side panel (Chrome) / toggles the sidebar (Firefox) instead of a popup.
if (chrome.sidePanel) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  });

  // setPanelBehavior is persisted by Chrome, but re-apply on startup to be safe.
  chrome.runtime.onStartup.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  });
} else if (chrome.sidebarAction) {
  // Registered synchronously at top level so Firefox can wake the event page for it.
  // toggle() only works inside a user-action handler, which the toolbar click is.
  chrome.action.onClicked.addListener(() => chrome.sidebarAction.toggle());
}

// ---------------------------------------------------------------------------
// Recording coordinator
//
// On Chrome the recorder runs in an offscreen document so it keeps going when the side panel
// is closed. On Firefox (no offscreen documents) the sidebar hosts the recorder itself and
// reports state changes here with `rec:state`. Either way the recording state lives in
// chrome.storage.session ({ recording: { id, startedAt, camera, mic, pausedAt, pausedMs, micMuted } })
// so the panel can pick it up whenever it (re)opens, and this worker can be suspended
// mid-recording without losing anything. The host that runs the recorder reports a full
// snapshot on every change (`rec:state` with `update: true`); this script only stores it.
// ---------------------------------------------------------------------------

const NEEDS_OFFSCREEN = new Set(['rec:start', 'rec:stop', 'rec:bubble', 'rec:pause', 'rec:resume', 'rec:mute', 'shot:screen']);

const OFFSCREEN_URL = 'offscreen/offscreen.html';
let creatingOffscreen = null;

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (existing.length) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['DISPLAY_MEDIA', 'USER_MEDIA'],
      justification:
        'Record the screen, the microphone and, optionally, the camera as a small bubble, or take a screen screenshot, while the side panel may be closed.',
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

async function closeOffscreen() {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // Already closed.
  }
}

/** Toolbar badge: '…' during the countdown, 'REC' while recording, 'II' while paused. */
function badgeFor(recording) {
  if (!recording) return null;
  if (recording.pausedAt) return { text: 'II', color: '#80838d' };
  if (recording.startedAt > Date.now()) return { text: '…', color: '#f5a524' };
  return { text: 'REC', color: '#e5484d' };
}

async function setRecording(recording) {
  await chrome.storage.session.set({ recording, recordingError: null });
  const badge = badgeFor(recording);
  await chrome.action.setBadgeText({ text: badge?.text ?? '' });
  if (badge) await chrome.action.setBadgeBackgroundColor({ color: badge.color });
}

async function handle(msg) {
  if (NEEDS_OFFSCREEN.has(msg.type) && !chrome.offscreen) {
    return { ok: false, error: 'This browser has no offscreen documents; the panel hosts the recorder itself.' };
  }
  switch (msg.type) {
    case 'rec:start': {
      const { recording } = await chrome.storage.session.get('recording');
      if (recording) return { ok: false, error: 'Already recording.' };
      await ensureOffscreen();
      // Resolves once the user has picked what to share (or cancelled).
      const res = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'rec:start',
        source: msg.source,
        resolution: msg.resolution,
        micDeviceId: msg.micDeviceId,
        cameraDeviceId: msg.cameraDeviceId,
        bubble: msg.bubble,
        delayMs: msg.delayMs,
        blur: msg.blur,
      });
      if (res?.ok) await setRecording(res.recording ?? { startedAt: Date.now(), camera: !!res.camera });
      else await closeOffscreen();
      return res ?? { ok: false, error: 'The recorder did not respond.' };
    }

    case 'rec:stop': {
      let res;
      try {
        res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'rec:stop' });
      } catch (err) {
        // Offscreen document is gone (e.g. crashed) — just clear the stale state.
        res = { ok: false, error: err.message };
      }
      await setRecording(null);
      await closeOffscreen();
      return res;
    }

    // Move/resize the camera bubble, pause/resume, mute/unmute the mic of the running recording.
    // The offscreen document reports the new state itself (`rec:state` with `update: true`).
    case 'rec:bubble':
    case 'rec:pause':
    case 'rec:resume':
    case 'rec:mute': {
      try {
        const { type, bubble, muted } = msg;
        return (await chrome.runtime.sendMessage({ target: 'offscreen', type, bubble, muted })) ?? { ok: false };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // "Entire screen" screenshot: the offscreen document shows Chrome's share picker and
    // grabs one frame. Keep the document if a recording is running in it.
    case 'shot:screen': {
      await ensureOffscreen();
      let res;
      try {
        res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'shot:screen' });
      } finally {
        const { recording } = await chrome.storage.session.get('recording');
        if (!recording) await closeOffscreen();
      }
      return res ?? { ok: false, error: 'The capture page did not respond.' };
    }

    // Sent by the offscreen document when the user ended sharing from Chrome's own bar.
    case 'rec:finished': {
      await setRecording(null);
      if (msg.error) await chrome.storage.session.set({ recordingError: msg.error });
      await closeOffscreen();
      return { ok: true };
    }

    // The recorder's host reports its state so this script stays the single owner of the session
    // state and the REC badge. Firefox: the sidebar sets it on start and clears it on stop
    // ({ recording | null, error? }). Both browsers: { recording, update: true } after the
    // countdown, a pause/resume or a mute. An update only applies to the recording it is about,
    // so a late one can't bring back a recording that was just stopped.
    case 'rec:state': {
      if (msg.update) {
        const { recording } = await chrome.storage.session.get('recording');
        if (!recording || !msg.recording || recording.id !== msg.recording.id) return { ok: false, stale: true };
        await setRecording(msg.recording);
        return { ok: true };
      }
      await setRecording(msg.recording ?? null);
      if (msg.error) await chrome.storage.session.set({ recordingError: msg.error });
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown message ${msg.type}` };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'background') return false;
  handle(msg).then(sendResponse, (err) => sendResponse({ ok: false, name: err.name, error: err.message }));
  return true; // async response
});
