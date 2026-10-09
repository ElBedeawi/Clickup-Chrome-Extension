// Screen (+ optional microphone) recorder built on getDisplayMedia + MediaRecorder.
// Runs inside the offscreen document (offscreen/offscreen.js) so it survives the side panel closing.

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

/**
 * @param {{ sink?: { reset(): Promise<void>, append(blob: Blob): Promise<void>, assemble(name: string, type: string): Promise<File> } }} [opts]
 * @returns {{
 *   start: (opts: { source?: 'screen'|'window'|'tab', resolution?: string, micDeviceId?: string | null }) => Promise<{ micError?: Error }>,
 *   stop: () => Promise<{ file: File, durationMs: number }>,
 *   isRecording: () => boolean,
 *   onAutoStop: ((result: { file?: File, durationMs: number, error?: Error }) => void) | null,
 * }}
 *   `onAutoStop` fires when the recording ended without `stop()` being called: the user used the
 *   browser's own "Stop sharing" control, or the recorder stopped on an error.
 */
export function createRecorder({ sink = memorySink() } = {}) {
  let displayStream = null;
  let micStream = null;
  let audioContext = null;
  let mediaRecorder = null;
  let startedAt = 0;
  let finished = null; // settles with the assembled file once the current recording has stopped
  let stopRequested = false;

  const api = {
    onAutoStop: null,
    isRecording: () => mediaRecorder?.state === 'recording',
    start,
    stop,
  };

  function cleanup() {
    for (const stream of [displayStream, micStream]) stream?.getTracks().forEach((t) => t.stop());
    displayStream = null;
    micStream = null;
    audioContext?.close().catch(() => {});
    audioContext = null;
  }

  async function start({ source = 'screen', resolution = '1080', micDeviceId = 'default' } = {}) {
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

    const tracks = [...displayStream.getVideoTracks()];
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
    let settle;
    finished = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    finished.catch(() => {}); // reported through stop() or onAutoStop, not as an unhandled rejection
    recorder.onstop = async () => {
      const durationMs = Date.now() - startedAt;
      const type = (recorder.mimeType || 'video/webm').split(';')[0];
      const auto = !stopRequested;
      mediaRecorder = null;
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

    recorder.start(1000);
    startedAt = Date.now();

    return { micError };
  }

  function endRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  }

  function stop() {
    if (stopRequested && finished) return finished;
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
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
