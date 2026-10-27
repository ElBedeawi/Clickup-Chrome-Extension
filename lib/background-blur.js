// Background blur for the camera bubble: MediaPipe's selfie segmenter (vendored, unmodified, in
// vendor/mediapipe/) tells the person from the background; the background is drawn blurred and
// the person sharp on top. Runs where the bubble is drawn: the recorder's host (lib/compositor.js)
// and the Record clip card's preview. Loaded only when blur is on.
//
// Privacy:
// - Frames never leave the device. MediaPipe's bundle has built-in usage logging to Google that
//   can't be switched off; installTelemetryGuard() refuses those requests before they are made,
//   and the extension's CSP (connect-src: ClickUp only) would block them anyway.
// - It fails closed: until the first mask exists, or after an error, the whole bubble is blurred.
//   The sharp camera is only ever drawn through a person mask.
//
// Only touches the DOM inside the factories, so the module can be imported in Node tests.
import { blurRadius, fillMaskAlpha, nextInterval, isBlockedTelemetry, isBlurLevel } from './blur-math.js';

const VENDOR = new URL('../vendor/mediapipe/', import.meta.url);
const INPUT_SIZE = 256; // the selfie segmenter's own input size
const LOAD_TIMEOUT_MS = 20_000;

/**
 * Wraps `fetch` in `scope` so requests to MediaPipe's logging endpoint are refused (a rejected
 * promise, like a network error: the bundle then stops logging). Everything else passes through.
 */
export function installTelemetryGuard(scope = globalThis) {
  if (scope.__uploaderTelemetryGuard || typeof scope.fetch !== 'function') return;
  const original = scope.fetch.bind(scope);
  scope.fetch = (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? input : input?.url;
    if (isBlockedTelemetry(url)) {
      return Promise.reject(new TypeError('Blocked: this extension only connects to ClickUp.'));
    }
    return original(input, init);
  };
  scope.__uploaderTelemetryGuard = true;
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/**
 * Loads the segmenter: GPU first, CPU if the GPU path fails to start or to run. Both need WebGL.
 * @returns {Promise<{ segmenter: object, delegate: 'GPU'|'CPU' }>}
 */
export async function loadSegmenter() {
  installTelemetryGuard();
  const { ImageSegmenter } = await import(new URL('vision_bundle.mjs', VENDOR).href);
  const fileset = {
    wasmLoaderPath: new URL('wasm/vision_wasm_internal.js', VENDOR).href,
    wasmBinaryPath: new URL('wasm/vision_wasm_internal.wasm', VENDOR).href,
  };
  const modelAssetPath = new URL('models/selfie_segmenter.tflite', VENDOR).href;
  const warmup = makeCanvas(INPUT_SIZE, INPUT_SIZE);
  warmup.getContext('2d').fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);

  let lastError;
  for (const delegate of ['GPU', 'CPU']) {
    let segmenter;
    try {
      // The bundle reads (then clears) self.Module: send its routine log lines to debug, not error.
      globalThis.Module = { print: console.debug, printErr: console.debug };
      segmenter = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      // GPU problems often only show up on the first run.
      segmenter.segmentForVideo(warmup, performance.now(), () => {});
      return { segmenter, delegate };
    } catch (err) {
      lastError = err;
      try {
        segmenter?.close();
      } catch {
        // already broken
      }
    }
  }
  throw new Error(`Background blur isn't available on this device (${lastError?.message ?? lastError}).`);
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Background blur took too long to start.')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * @param {{ level: 'medium'|'high', load?: typeof loadSegmenter }} opts
 * @returns {{
 *   ready: Promise<void>,
 *   update(camera: CanvasImageSource, crop: { sx: number, sy: number, sw: number, sh: number }, now?: number): void,
 *   draw(ctx: CanvasRenderingContext2D, camera: CanvasImageSource, crop: object, d: number): void,
 *   setLevel(level: string): void,
 *   readonly level: string, readonly failed: boolean, readonly delegate: string | null,
 *   close(): void,
 * }}
 *   `crop` is the part of the camera frame the bubble shows (lib/geometry.js coverFitSource);
 *   `draw` paints the bubble content into (0, 0, d, d) of the current transform.
 */
export function createBlurrer({ level, load = loadSegmenter }) {
  if (!isBlurLevel(level) || level === 'none') throw new Error(`Unknown blur level: ${level}`);
  let current = level;
  let segmenter = null;
  let delegate = null;
  let failed = false;
  let closed = false;
  let hasMask = false;
  let nextAt = 0;
  let lastTs = 0;

  const input = makeCanvas(INPUT_SIZE, INPUT_SIZE);
  const inputCtx = input.getContext('2d');
  const mask = makeCanvas(INPUT_SIZE, INPUT_SIZE);
  const maskCtx = mask.getContext('2d');
  let maskData = maskCtx.createImageData(INPUT_SIZE, INPUT_SIZE);
  const padded = makeCanvas(1, 1); // the camera crop with its edges stretched outwards
  const paddedCtx = padded.getContext('2d');
  const blurred = makeCanvas(1, 1);
  const blurredCtx = blurred.getContext('2d');
  const person = makeCanvas(1, 1);
  const personCtx = person.getContext('2d');

  const ready = withTimeout(load(), LOAD_TIMEOUT_MS).then(
    (loaded) => {
      if (closed) {
        loaded.segmenter.close();
        return;
      }
      segmenter = loaded.segmenter;
      delegate = loaded.delegate;
    },
    (err) => {
      failed = true;
      throw err;
    },
  );
  ready.catch(() => {}); // callers await it; an unawaited failure must not be "unhandled"

  function onResult(result) {
    const m = result?.confidenceMasks?.[0];
    if (!m) return;
    if (m.width !== mask.width || m.height !== mask.height) {
      mask.width = m.width;
      mask.height = m.height;
      maskData = maskCtx.createImageData(m.width, m.height);
    }
    fillMaskAlpha(m.getAsFloat32Array(), maskData.data);
    maskCtx.putImageData(maskData, 0, 0);
    hasMask = true;
  }

  /** The blurred bubble background, at half resolution (blur hides it, and it's 4x cheaper). */
  function drawBlurred(ctx, camera, crop, d) {
    const scale = 0.5;
    const size = Math.max(8, Math.round(d * scale));
    const radius = Math.max(2, Math.round(blurRadius(current, d) * scale));
    const pad = radius * 3; // CSS blur reaches ~3 radii; padding keeps the edge from fading out
    const full = size + 2 * pad;
    if (padded.width !== full) padded.width = padded.height = full;
    if (blurred.width !== size) blurred.width = blurred.height = size;
    const { sx, sy, sw, sh } = crop;
    // Centre, then the edges stretched outwards (an edge clamp), so the blur has real pixels to use.
    paddedCtx.drawImage(camera, sx, sy, sw, sh, pad, pad, size, size);
    paddedCtx.drawImage(camera, sx, sy, sw, 1, pad, 0, size, pad); // top
    paddedCtx.drawImage(camera, sx, sy + sh - 1, sw, 1, pad, pad + size, size, pad); // bottom
    paddedCtx.drawImage(padded, pad, 0, 1, full, 0, 0, pad, full); // left (incl. corners)
    paddedCtx.drawImage(padded, pad + size - 1, 0, 1, full, pad + size, 0, pad, full); // right
    blurredCtx.filter = `blur(${radius}px)`;
    blurredCtx.drawImage(padded, -pad, -pad);
    blurredCtx.filter = 'none';
    ctx.drawImage(blurred, 0, 0, size, size, 0, 0, d, d);
  }

  const api = {
    ready,
    get level() {
      return current;
    },
    get failed() {
      return failed;
    },
    get delegate() {
      return delegate;
    },
    setLevel(next) {
      if (isBlurLevel(next) && next !== 'none') current = next;
    },
    update(camera, crop, now = performance.now()) {
      if (!segmenter || failed || closed || now < nextAt) return;
      try {
        inputCtx.drawImage(camera, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, INPUT_SIZE, INPUT_SIZE);
        const started = performance.now();
        lastTs = Math.max(now, lastTs + 1); // VIDEO mode wants strictly increasing timestamps
        segmenter.segmentForVideo(input, lastTs, onResult);
        nextAt = now + nextInterval(performance.now() - started);
      } catch (err) {
        // E.g. a lost WebGL context. Stay fully blurred from here on.
        failed = true;
        console.warn('Background blur stopped working; the bubble stays fully blurred.', err);
      }
    },
    draw(ctx, camera, crop, d) {
      drawBlurred(ctx, camera, crop, d);
      if (!hasMask || failed) return; // fail closed: no mask, no sharp camera
      if (person.width !== d) person.width = person.height = d;
      personCtx.globalCompositeOperation = 'source-over';
      personCtx.clearRect(0, 0, d, d);
      personCtx.drawImage(mask, 0, 0, mask.width, mask.height, 0, 0, d, d);
      personCtx.globalCompositeOperation = 'source-in';
      personCtx.drawImage(camera, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, d, d);
      personCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(person, 0, 0);
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        segmenter?.close();
      } catch {
        // nothing left to free
      }
      segmenter = null;
    },
  };
  return api;
}
