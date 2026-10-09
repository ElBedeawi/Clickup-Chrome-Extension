// Chrome's recorder host: an offscreen document, so recording keeps going while the side panel
// is closed. Driven by background.js over runtime messages; results go to IndexedDB for the
// side panel / editor to pick up. (Firefox has no offscreen documents; there the sidebar hosts
// the same session itself — see sidepanel/sidepanel.js.)
import { createCaptureSession } from '../lib/capture-session.js';

const session = createCaptureSession({
  // User clicked Chrome's "Stop sharing" bar — nobody asked us to stop, so tell the background.
  onFinished: ({ error }) => chrome.runtime.sendMessage({ target: 'background', type: 'rec:finished', error }),
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  const result = session.handle(msg);
  if (!result) return false;
  result.then(sendResponse, (err) => sendResponse({ ok: false, name: err.name, error: err.message }));
  return true; // async response
});
