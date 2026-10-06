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

function pad(n) {
  return String(n).padStart(2, '0');
}

export function recordingFileName(date = new Date()) {
  return `recording-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}.webm`;
}

/**
 * @returns {{
 *   start: (opts: { mic: boolean }) => Promise<{ micError?: Error }>,
 *   stop: () => Promise<{ file: File, durationMs: number }>,
 *   isRecording: () => boolean,
 *   onAutoStop: ((result: { file: File, durationMs: number }) => void) | null,
 * }}
 */
export function createRecorder() {
  let displayStream = null;
  let micStream = null;
  let audioContext = null;
  let mediaRecorder = null;
  let chunks = [];
  let startedAt = 0;
  let stopPromise = null;

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

  async function start({ mic }) {
    if (api.isRecording()) throw new Error('Already recording.');
    chunks = [];
    stopPromise = null;

    // Allowed in an offscreen document created with the DISPLAY_MEDIA reason; Chrome shows the picker.
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30 } },
      audio: true, // system/tab audio, if the user ticks "share audio"
    });

    let micError;
    if (mic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
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
    mediaRecorder = new MediaRecorder(new MediaStream(tracks), mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    // User clicked Chrome's "Stop sharing" bar.
    displayStream.getVideoTracks()[0].addEventListener('ended', async () => {
      if (!api.isRecording()) return;
      const result = await stop();
      api.onAutoStop?.(result);
    });

    mediaRecorder.start(1000);
    startedAt = Date.now();

    return { micError };
  }

  function stop() {
    if (stopPromise) return stopPromise;
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      return Promise.reject(new Error('Not recording.'));
    }

    stopPromise = new Promise((resolve) => {
      const recorder = mediaRecorder;
      recorder.onstop = () => {
        const durationMs = Date.now() - startedAt;
        const type = (recorder.mimeType || 'video/webm').split(';')[0];
        const file = new File(chunks, recordingFileName(), { type });
        chunks = [];
        mediaRecorder = null;
        cleanup();
        resolve({ file, durationMs });
      };
      recorder.stop();
    });
    return stopPromise;
  }

  return api;
}
