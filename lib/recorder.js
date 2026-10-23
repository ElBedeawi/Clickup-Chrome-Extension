// Screen (+ optional microphone and camera bubble) recorder built on getDisplayMedia + MediaRecorder.
// Runs inside the offscreen document (offscreen/offscreen.js) so it survives the side panel closing.
import { createCompositor } from './compositor.js';

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

function pickMimeType() {
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

// "Record clip" resolution choices → max capture size. Chrome scales the capture down to
// fit; it never upscales, so picking 4K on a 1080p screen simply records at 1080p.
const MAX_SIZE = { 720: [1280, 720], 1080: [1920, 1080], 1440: [2560, 1440], 2160: [3840, 2160] };

// Preselects the matching pane in Chrome's share picker.
const SURFACE = { screen: 'monitor', window: 'window', tab: 'browser' };

/** ~0.1 bits per pixel per frame: crisp text without huge files (1080p30 ≈ 6 Mbps). */
function bitrateFor(track) {
  const { width = 1920, height = 1080, frameRate = 30 } = track.getSettings();
  return Math.round(Math.min(Math.max(width * height * Math.min(frameRate, 30) * 0.1, 1_500_000), 25_000_000));
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function recordingFileName(date = new Date()) {
  return `recording-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}.webm`;
}

/** Default sink: keeps chunks in memory. The offscreen recorder uses a disk-backed one. */
function memorySink() {
  let chunks = [];
  return {
    reset: async () => {
      chunks = [];
    },
    append: async (blob) => {
      chunks.push(blob);
    },
    assemble: async (name, type) => {
      const file = new File(chunks, name, { type });
      chunks = [];
      return file;
    },
  };
}

/** Camera frames are only ever drawn into a small bubble; a modest size keeps CPU use down. */
const CAMERA_VIDEO = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } };

/**
 * @typedef {{ id: number, state: 'idle'|'countdown'|'recording'|'paused', startedAt: number,
 *             pausedAt: number | null, pausedMs: number, mic: boolean, micMuted: boolean, camera: boolean }} RecorderStatus
 *   `startedAt` is when recording (re)starts counting: in the future during the countdown.
 *   `pausedMs` is the total time spent paused so far, not counting a pause still in progress.
 */

/**
 * @param {{
 *   sink?: { reset(): Promise<void>, append(blob: Blob): Promise<void>, assemble(name: string, type: string): Promise<File> },
 *   compositor?: typeof createCompositor,
 * }} [opts]
 * @returns {{
 *   start: (opts: { source?: 'screen'|'window'|'tab', resolution?: string, micDeviceId?: string | null,
 *                   cameraDeviceId?: string | null, bubble?: { x: number, y: number, size?: string }, delayMs?: number })
 *     => Promise<{ micError?: Error, cameraError?: Error }>,
 *   stop: () => Promise<{ file: File | null, durationMs: number, cancelled?: boolean }>,
 *   pause: () => void,
 *   resume: () => void,
 *   setMicMuted: (muted: boolean) => boolean,
 *   setBubble: (bubble: { x?: number, y?: number, size?: string }) => boolean,
 *   isRecording: () => boolean,
 *   status: () => RecorderStatus,
 *   onAutoStop: ((result: { file?: File | null, durationMs: number, error?: Error, cancelled?: boolean }) => void) | null,
 *   onChange: ((status: RecorderStatus) => void) | null,
 * }}
 *   `onAutoStop` fires when the recording ended without `stop()` being called: the user used the
 *   browser's own "Stop sharing" control, or the recorder stopped on an error.
 *   `delayMs` is the countdown: the share session is set up right away (the picker needs the
 *   click), but nothing is recorded until it runs out. Ending it early (stop, or the browser's
 *   "Stop sharing") cancels the clip: no file. `isRecording()` is true during the countdown and
 *   while paused, so nobody mistakes either for "idle".
 *   `onChange` fires when the countdown runs out and on pause, resume and mute.
 *   A camera (`cameraDeviceId`) is drawn into the clip as a round bubble by the `compositor`;
 *   `setBubble` moves/resizes it mid-recording. Like the mic, a camera failure doesn't stop the
 *   recording: it is reported as `cameraError` and the clip simply has no bubble.
 */
export function createRecorder({ sink = memorySink(), compositor = createCompositor } = {}) {
  let displayStream = null;
  let micStream = null;
  let cameraStream = null;
  let composite = null;
  let audioContext = null;
  let mediaRecorder = null;
  let state = 'idle';
  let id = 0;
  let startedAt = 0;
  let pausedAt = null;
  let pausedMs = 0;
  let micMuted = false;
  let countdownTimer = 0;
  let finished = null; // settles with the assembled file once the current recording has stopped
  let settle = null;
  let stopRequested = false;

  const api = {
    onAutoStop: null,
    onChange: null,
    isRecording: () => state !== 'idle',
    status: () => ({
      id,
      state,
      startedAt,
      pausedAt,
      pausedMs,
      mic: !!micStream?.getAudioTracks().length,
      micMuted,
      camera: !!composite,
    }),
    start,
    stop,
    pause() {
      if (state === 'paused') return;
      if (state !== 'recording') throw new Error('Not recording.');
      // Pausing doesn't flush the current timeslice: write it now, so a Firefox sidebar closed
      // while paused still leaves everything up to the pause on disk.
      mediaRecorder.requestData();
      mediaRecorder.pause();
      pausedAt = Date.now();
      state = 'paused';
      changed();
    },
    resume() {
      if (state === 'recording') return;
      if (state !== 'paused') throw new Error('Not paused.');
      mediaRecorder.resume();
      pausedMs += Date.now() - pausedAt;
      pausedAt = null;
      state = 'recording';
      changed();
    },
    /** Silences the microphone (a disabled track records silence) without ending it. */
    setMicMuted(muted) {
      if (!micStream || state === 'idle') return false;
      micMuted = !!muted;
      micStream.getAudioTracks().forEach((t) => {
        t.enabled = !micMuted;
      });
      changed();
      return true;
    },
    setBubble(bubble) {
      if (!composite) return false;
      composite.setLayout(bubble);
      return true;
    },
  };

  function changed() {
    try {
      api.onChange?.(api.status());
    } catch (err) {
      console.error('Recorder onChange failed', err);
    }
  }

  function cleanup() {
    composite?.stop();
    composite = null;
    for (const stream of [displayStream, micStream, cameraStream]) stream?.getTracks().forEach((t) => t.stop());
    displayStream = null;
    micStream = null;
    cameraStream = null;
    audioContext?.close().catch(() => {});
    audioContext = null;
  }

  async function start({ source = 'screen', resolution = '1080', micDeviceId = 'default', cameraDeviceId = null, bubble, delayMs = 0 } = {}) {
    if (api.isRecording()) throw new Error('Already recording.');
    finished = null;
    stopRequested = false;
    await sink.reset();

    const video = { frameRate: { ideal: 30, max: 30 } };
    const size = MAX_SIZE[resolution];
    if (size) {
      video.width = { max: size[0] };
      video.height = { max: size[1] };
    }
    if (SURFACE[source]) video.displaySurface = SURFACE[source];

    // Allowed in an offscreen document created with the DISPLAY_MEDIA reason; Chrome shows the picker.
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video,
      audio: true, // system/tab audio, if the user ticks "share audio"
      systemAudio: 'include',
      surfaceSwitching: 'include',
    });

    let micError;
    if (micDeviceId) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(micDeviceId === 'default' ? {} : { deviceId: { exact: micDeviceId } }),
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
      } catch (err) {
        // Keep recording the screen even if mic access is denied.
        micError = err;
      }
    }

    let cameraError;
    if (cameraDeviceId) {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { ...CAMERA_VIDEO, ...(cameraDeviceId === 'default' ? {} : { deviceId: { exact: cameraDeviceId } }) },
          audio: false,
        });
      } catch (err) {
        // Keep recording the screen even if the camera is denied or busy.
        cameraError = err;
      }
    }

    // With a camera, record the composited canvas instead of the raw display track.
    let videoTrack = displayStream.getVideoTracks()[0];
    if (cameraStream) {
      composite = compositor({ displayStream, cameraStream, layout: { x: 0, y: 1, size: 'md', ...bubble } });
      await composite.ready;
      videoTrack = composite.stream.getVideoTracks()[0];
    }

    const tracks = [videoTrack];
    const audioSources = [displayStream, micStream].filter((s) => s && s.getAudioTracks().length);

    if (audioSources.length === 1) {
      tracks.push(...audioSources[0].getAudioTracks());
    } else if (audioSources.length > 1) {
      // Mix system audio and mic into a single track — MediaRecorder only records one audio track.
      audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      for (const source of audioSources) audioContext.createMediaStreamSource(source).connect(destination);
      tracks.push(...destination.stream.getAudioTracks());
    }

    const mimeType = pickMimeType();
    mediaRecorder = new MediaRecorder(new MediaStream(tracks), {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: bitrateFor(displayStream.getVideoTracks()[0]),
    });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) sink.append(e.data).catch((err) => console.error('Saving chunk failed', err));
    };

    // Everything that ends a recording funnels into the recorder's own `stop` event, whoever
    // caused it: our stop(), the user's "Stop sharing" control (the track ends — in Firefox the
    // recorder may already have gone inactive by the time that event reaches us), or an error.
    const recorder = mediaRecorder;
    finished = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    finished.catch(() => {}); // reported through stop() or onAutoStop, not as an unhandled rejection
    recorder.onstop = async () => {
      const durationMs = Date.now() - startedAt;
      const type = (recorder.mimeType || 'video/webm').split(';')[0];
      const auto = !stopRequested;
      mediaRecorder = null;
      state = 'idle';
      cleanup();
      try {
        // The final chunk arrives in a dataavailable just before onstop; assemble waits for it.
        const result = { file: await sink.assemble(recordingFileName(), type), durationMs };
        settle.resolve(result);
        if (auto) api.onAutoStop?.(result);
      } catch (error) {
        settle.reject(error);
        if (auto) api.onAutoStop?.({ durationMs, error });
      }
    };
    recorder.onerror = (e) => {
      console.error('MediaRecorder error', e.error || e);
      endRecording(); // browsers fire `stop` after `error` anyway; make sure of it
    };
    displayStream.getVideoTracks()[0].addEventListener('ended', endRecording);

    id = Date.now();
    pausedAt = null;
    pausedMs = 0;
    micMuted = false;
    const begin = () => {
      countdownTimer = 0;
      recorder.start(1000);
      startedAt = Date.now();
      state = 'recording';
    };
    if (delayMs > 0) {
      state = 'countdown';
      startedAt = Date.now() + delayMs;
      countdownTimer = setTimeout(() => {
        try {
          begin();
        } catch (error) {
          console.error('Starting the recorder failed', error);
          cancelCountdown({ auto: true, error });
          return;
        }
        changed();
      }, delayMs);
    } else {
      begin();
    }

    return { micError, cameraError };
  }

  /** Ends the countdown before anything was recorded: there is no clip, and nothing to assemble. */
  function cancelCountdown({ auto, error }) {
    clearTimeout(countdownTimer);
    countdownTimer = 0;
    const recorder = mediaRecorder;
    mediaRecorder = null;
    state = 'idle';
    if (recorder) recorder.onstop = recorder.ondataavailable = recorder.onerror = null;
    cleanup();
    const result = { file: null, durationMs: 0, cancelled: true, ...(error ? { error } : {}) };
    settle.resolve(result);
    if (auto) api.onAutoStop?.(result);
  }

  function endRecording() {
    if (state === 'countdown') return cancelCountdown({ auto: !stopRequested });
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  }

  function stop() {
    if (stopRequested && finished) return finished;
    if (state === 'idle' || !mediaRecorder) {
      return Promise.reject(new Error('Not recording.'));
    }
    stopRequested = true;
    endRecording();
    return finished;
  }

  return api;
}

/**
 * One-off screenshot of a screen/window/tab the user picks in Chrome's share dialog.
 * @returns {Promise<File>}
 */
export async function captureDisplayFrame(fileName) {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    // Give the capture a moment to deliver a real frame (the first can be blank).
    await new Promise((resolve) => setTimeout(resolve, 250));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return new File([blob], fileName, { type: 'image/png' });
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}
