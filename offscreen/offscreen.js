// Owns the MediaRecorder (and one-off "Entire screen" screenshots). Driven by background.js;
// results go to IndexedDB for the side panel / editor to pick up.
import { createRecorder, captureDisplayFrame } from '../lib/recorder.js';
import { saveAttachment, createChunkSink } from '../lib/attachments-db.js';
import { screenshotFileName } from '../lib/screenshot.js';

// Chunks are written to disk as they arrive, so long recordings don't sit in memory.
const recorder = createRecorder({ sink: createChunkSink() });

// User clicked Chrome's "Stop sharing" bar — nobody asked us to stop, so tell the background.
recorder.onAutoStop = async ({ file }) => {
  let error;
  try {
    await saveAttachment(file);
  } catch (err) {
    error = `Could not save the recording: ${err.message}`;
  }
  chrome.runtime.sendMessage({ target: 'background', type: 'rec:finished', error });
};

async function handle(msg) {
  switch (msg.type) {
    case 'rec:start': {
      const { micError } = await recorder.start({
        source: msg.source,
        resolution: msg.resolution,
        micDeviceId: msg.micDeviceId,
      });
      return { ok: true, micError: micError?.name };
    }
    case 'rec:stop': {
      const { file } = await recorder.stop();
      await saveAttachment(file);
      return { ok: true };
    }
    case 'shot:screen': {
      const file = await captureDisplayFrame(screenshotFileName());
      const draftId = await saveAttachment(file, { draft: true });
      return { ok: true, draftId };
    }
    default:
      return { ok: false, error: `Unknown message ${msg.type}` };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  handle(msg).then(sendResponse, (err) => sendResponse({ ok: false, name: err.name, error: err.message }));
  return true; // async response
});
