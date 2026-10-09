// One recording (or one-off "Entire screen" screenshot) and where its result goes: IndexedDB,
// for the side panel / editor to pick up. The host that owns the session differs per browser:
// Chrome's offscreen document (offscreen/offscreen.js, message-driven) or the Firefox sidebar
// itself (sidepanel/sidepanel.js, direct calls). Dependencies are injectable for unit tests.
import { createRecorder, captureDisplayFrame, recordingFileName } from './recorder.js';
import { saveAttachment, createChunkSink, listChunks, clearChunks } from './attachments-db.js';
import { screenshotFileName } from './screenshot.js';

/**
 * @param {{
 *   sink?: ReturnType<typeof createChunkSink>,
 *   recorder?: ReturnType<typeof createRecorder>,
 *   save?: typeof saveAttachment,
 *   frame?: typeof captureDisplayFrame,
 *   fileName?: () => string,
 *   onFinished?: (result: { error?: string }) => void,
 * }} [deps]
 *   `onFinished` fires when the user ended sharing from the browser's own bar: nobody asked the
 *   session to stop, so the owner of the recording state has to be told.
 */
export function createCaptureSession({
  sink = createChunkSink(), // chunks go to disk as they arrive
  recorder = createRecorder({ sink }),
  save = saveAttachment,
  frame = captureDisplayFrame,
  fileName = screenshotFileName,
  onFinished = null,
} = {}) {
  // Save first, then let the sink drop its chunks: on Firefox the assembled File reads from
  // them and would turn unreadable the other way round. If saving fails the chunks stay on
  // disk, where the next start (or Firefox's recovery) picks them up.
  async function persist(file) {
    await save(file);
    await sink.release?.();
  }

  recorder.onAutoStop = async ({ file, error: recorderError }) => {
    let error;
    if (recorderError) {
      // Chunks stay on disk for the next start / Firefox's recovery to pick up.
      error = `The recording ended with an error: ${recorderError?.message ?? recorderError}`;
    } else {
      try {
        await persist(file);
      } catch (err) {
        error = `Could not save the recording: ${err?.message ?? err}`;
      }
    }
    onFinished?.({ error });
  };

  const session = {
    isRecording: () => recorder.isRecording(),

    async start({ source, resolution, micDeviceId } = {}) {
      const { micError } = await recorder.start({ source, resolution, micDeviceId });
      return { ok: true, micError: micError?.name };
    },

    async stop() {
      const { file } = await recorder.stop();
      await persist(file);
      return { ok: true };
    },

    async screenshot() {
      const file = await frame(fileName());
      const draftId = await save(file, { draft: true });
      return { ok: true, draftId };
    },

    /**
     * Message-shaped entry point for `chrome.runtime.onMessage` hosts.
     * @returns {Promise<object> | null} null when this host must not answer (a `rec:ping` while
     *   idle), so the listener can return false and leave the channel to a host that is recording.
     */
    handle(msg) {
      switch (msg.type) {
        case 'rec:start':
          return session.start(msg);
        case 'rec:stop':
          return session.stop();
        case 'shot:screen':
          return session.screenshot();
        case 'rec:ping':
          return recorder.isRecording() ? Promise.resolve({ ok: true, recording: true }) : null;
        default:
          return Promise.resolve({ ok: false, error: `Unknown message ${msg.type}` });
      }
    },
  };
  return session;
}

/**
 * Firefox only: the sidebar hosting a recording was closed, so the recorder died but its chunks
 * are still on disk. Turns them into an attachment, unless a sidebar in another window is the
 * one still writing them (`hostAlive` asks around with a `rec:ping`).
 * @returns {Promise<File | null>} the recovered file, or null if there was nothing to recover
 */
export async function recoverInterruptedRecording({
  hostAlive,
  list = listChunks,
  clear = clearChunks,
  save = saveAttachment,
  name = recordingFileName(),
}) {
  const chunks = await list();
  if (!chunks.length) return null;
  if (await hostAlive()) return null;
  const type = chunks[0].type?.split(';')[0] || 'video/webm';
  const file = new File(chunks, name, { type });
  await save(file);
  await clear();
  return file;
}
