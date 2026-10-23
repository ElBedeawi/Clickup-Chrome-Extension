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
 *   onChange?: (recording: RecordingState) => void,
 * }} [deps]
 *   `onFinished` fires when the user ended sharing from the browser's own bar: nobody asked the
 *   session to stop, so the owner of the recording state has to be told.
 *   `onChange` fires with a fresh snapshot when the countdown runs out and on pause, resume and
 *   mute: this host is the only one that knows, so it reports the whole state, never a patch.
 */
export function createCaptureSession({
  sink = createChunkSink(), // chunks go to disk as they arrive
  recorder = createRecorder({ sink }),
  save = saveAttachment,
  frame = captureDisplayFrame,
  fileName = screenshotFileName,
  onFinished = null,
  onChange = null,
} = {}) {
  /**
   * What goes into chrome.storage.session `recording` (see lib/recording-state.js).
   * @typedef {{ id: number, startedAt: number, camera: boolean, mic: boolean,
   *             pausedAt: number | null, pausedMs: number, micMuted: boolean }} RecordingState
   * @returns {RecordingState}
   */
  function snapshot() {
    const { id, startedAt, camera, mic, pausedAt, pausedMs, micMuted } = recorder.status();
    return { id, startedAt, camera, mic, pausedAt, pausedMs, micMuted };
  }

  recorder.onChange = () => onChange?.(snapshot());

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
    } else if (file) {
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
    /** 'idle' | 'countdown' | 'recording' | 'paused' */
    state: () => recorder.status().state,
    snapshot,

    async start({ source, resolution, micDeviceId, cameraDeviceId, bubble, delayMs } = {}) {
      const { micError, cameraError } = await recorder.start({ source, resolution, micDeviceId, cameraDeviceId, bubble, delayMs });
      return {
        ok: true,
        micError: micError?.name,
        cameraError: cameraError?.name,
        camera: !!cameraDeviceId && !cameraError,
        recording: snapshot(),
      };
    },

    /** Moves/resizes the camera bubble of the running recording. */
    async setBubble(bubble) {
      return { ok: recorder.setBubble(bubble) };
    },

    async pause() {
      recorder.pause();
      return { ok: true };
    },

    async resume() {
      recorder.resume();
      return { ok: true };
    },

    async setMicMuted(muted) {
      return { ok: recorder.setMicMuted(muted) };
    },

    async stop() {
      const { file } = await recorder.stop();
      if (!file) return { ok: true, cancelled: true }; // stopped during the countdown: nothing recorded
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
     * @returns {Promise<object> | null} null when this host must not answer (a `rec:ping`,
     *   `rec:bubble`, `rec:pause`, `rec:resume` or `rec:mute` while idle), so the listener can
     *   return false and leave the channel to a host that is recording.
     */
    handle(msg) {
      const live = recorder.isRecording();
      switch (msg.type) {
        case 'rec:start':
          return session.start(msg);
        case 'rec:stop':
          return session.stop();
        case 'rec:bubble':
          return live ? session.setBubble(msg.bubble) : null;
        case 'rec:pause':
          return live ? session.pause() : null;
        case 'rec:resume':
          return live ? session.resume() : null;
        case 'rec:mute':
          return live ? session.setMicMuted(!!msg.muted) : null;
        case 'shot:screen':
          return session.screenshot();
        case 'rec:ping':
          return live ? Promise.resolve({ ok: true, recording: true }) : null;
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
