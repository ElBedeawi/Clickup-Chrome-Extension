// Owns the MediaRecorder. Driven by background.js; finished recordings go to IndexedDB.
import { createRecorder } from '../lib/recorder.js';
import { saveAttachment } from '../lib/attachments-db.js';

const recorder = createRecorder();

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
      const { micError } = await recorder.start({ mic: msg.mic });
      return { ok: true, micError: micError?.name };
    }
    case 'rec:stop': {
      const { file } = await recorder.stop();
      await saveAttachment(file);
      return { ok: true };
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
