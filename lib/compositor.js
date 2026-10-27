// Draws the screen capture with the camera as a round bubble on top, and hands the result
// back as a MediaStream for MediaRecorder. Runs in the recorder's host (Chrome: the offscreen
// document; Firefox: the sidebar page). Only uses the DOM inside the factory, so the module
// can be imported in Node tests (the recorder takes it as an injectable dependency).
import { bubbleRect, coverFitSource } from './geometry.js';

const READY_TIMEOUT_MS = 1500;

function makeVideo(stream) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.play().catch(() => {}); // autoplay can't be blocked for a muted MediaStream, but be safe
  return video;
}

function pickRequestFrame(stream) {
  const track = stream.getVideoTracks()[0];
  if (typeof track?.requestFrame === 'function') return () => track.requestFrame();
  if (typeof stream.requestFrame === 'function') return () => stream.requestFrame();
  return null;
}

/** A 30 Hz clock that keeps ticking in a document that is never rendered (see tick-worker.js). */
function createClock(fps, onTick) {
  let worker = null;
  let timer = 0;
  try {
    worker = new Worker(new URL('./tick-worker.js', import.meta.url));
    worker.onmessage = onTick;
    worker.postMessage({ fps });
  } catch {
    worker = null;
    timer = setInterval(onTick, 1000 / fps);
  }
  return {
    stop() {
      if (worker) {
        worker.postMessage({ fps: 0 });
        worker.terminate();
        worker = null;
      }
      clearInterval(timer);
    },
  };
}

/**
 * @param {{ displayStream: MediaStream, cameraStream: MediaStream,
 *           layout: { x: number, y: number, size?: string }, fps?: number,
 *           blurrer?: ReturnType<import('./background-blur.js').createBlurrer> | null }} opts
 * @returns {{ stream: MediaStream, canvas: HTMLCanvasElement, ready: Promise<void>, setLayout(layout: object): void, stop(): void }}
 *   `ready` resolves once the first screen frame has been drawn (or after a short timeout), so
 *   the recorder doesn't start on a blank canvas. With a `blurrer` (already loaded), the bubble's
 *   background is blurred; the blurrer belongs to the caller, which closes it.
 */
export function createCompositor({ displayStream, cameraStream, layout, fps = 30, blurrer = null }) {
  let current = { ...layout };
  const screen = makeVideo(displayStream);
  const camera = makeVideo(cameraStream);
  const cameraTrack = cameraStream.getVideoTracks()[0];

  const canvas = document.createElement('canvas');
  const settings = displayStream.getVideoTracks()[0]?.getSettings?.() || {};
  canvas.width = settings.width || 1280;
  canvas.height = settings.height || 720;
  const ctx = canvas.getContext('2d', { alpha: false });

  // Frame rate 0: frames are produced only by requestFrame(), i.e. by our clock below. Chrome
  // has requestFrame() on the track, Firefox on the stream; failing both, let the canvas
  // stream pick up frames itself.
  let stream = canvas.captureStream(0);
  let requestFrame = pickRequestFrame(stream);
  if (!requestFrame) {
    stream.getTracks().forEach((t) => t.stop());
    stream = canvas.captureStream(fps);
    requestFrame = () => {};
  }

  let firstFrame;
  const ready = new Promise((resolve) => {
    firstFrame = resolve;
    setTimeout(resolve, READY_TIMEOUT_MS);
  });

  function draw() {
    if (screen.videoWidth === 0) return; // no frame yet
    if (canvas.width !== screen.videoWidth || canvas.height !== screen.videoHeight) {
      // Surface switching / window resize changed the capture size.
      canvas.width = screen.videoWidth;
      canvas.height = screen.videoHeight;
    }
    ctx.drawImage(screen, 0, 0, canvas.width, canvas.height);

    if (camera.videoWidth > 0 && cameraTrack?.readyState === 'live') {
      const { x, y, r } = bubbleRect({ canvasW: canvas.width, canvasH: canvas.height, layout: current });
      const d = 2 * r;
      const { sx, sy, sw, sh } = coverFitSource(camera.videoWidth, camera.videoHeight, d, d);
      ctx.save();
      // Soft shadow under the bubble so it reads on any background.
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = Math.max(4, r * 0.15);
      ctx.shadowOffsetY = Math.max(1, r * 0.04);
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      // Mirrored, like a selfie view, so the user's movements feel natural.
      ctx.translate(x + r, y - r);
      ctx.scale(-1, 1);
      if (blurrer) {
        const crop = { sx, sy, sw, sh };
        blurrer.update(camera, crop);
        blurrer.draw(ctx, camera, crop, d);
      } else {
        ctx.drawImage(camera, sx, sy, sw, sh, 0, 0, d, d);
      }
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(2, r * 0.06);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
      ctx.restore();
    }

    requestFrame();
    firstFrame();
  }

  const clock = createClock(fps, draw);

  return {
    stream,
    canvas, // exposed for tests / debugging
    ready,
    setLayout(next) {
      current = { ...current, ...next };
    },
    stop() {
      clock.stop();
      for (const v of [screen, camera]) {
        v.pause();
        v.srcObject = null;
      }
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
