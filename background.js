// Clicking the toolbar icon opens the side panel instead of a popup.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

// setPanelBehavior is persisted by Chrome, but re-apply on startup to be safe.
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

// ---------------------------------------------------------------------------
// Recording coordinator
//
// The recorder runs in an offscreen document so it keeps going when the side panel
// is closed. Recording state lives in chrome.storage.session ({ recording: { startedAt } })
// so the side panel can pick it up whenever it (re)opens, and this worker can be
// suspended mid-recording without losing anything.
// ---------------------------------------------------------------------------

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
      justification: 'Record the screen and microphone, or take a screen screenshot, while the side panel may be closed.',
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

async function setRecording(recording) {
  await chrome.storage.session.set({ recording, recordingError: null });
  await chrome.action.setBadgeText({ text: recording ? 'REC' : '' });
  if (recording) await chrome.action.setBadgeBackgroundColor({ color: '#e5484d' });
}

async function handle(msg) {
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
      });
      if (res?.ok) await setRecording({ startedAt: Date.now() });
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

    default:
      return { ok: false, error: `Unknown message ${msg.type}` };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'background') return false;
  handle(msg).then(sendResponse, (err) => sendResponse({ ok: false, name: err.name, error: err.message }));
  return true; // async response
});
