// Pure helpers for the camera-bubble background blur (lib/background-blur.js). No DOM, no
// chrome.*: unit-tested in Node.

/** The levels offered in the Record clip card, in menu order. */
export const BLUR_LEVELS = ['none', 'medium', 'high'];

export function isBlurLevel(level) {
  return BLUR_LEVELS.includes(level);
}

/**
 * Blur radius in pixels for a bubble `d` pixels across. Scales with the bubble so S, M and L
 * look alike; never so small that the background stays readable.
 */
export function blurRadius(level, d) {
  const frac = { medium: 0.04, high: 0.09 }[level];
  if (!frac) return 0;
  return Math.max(3, Math.round(frac * d));
}

/**
 * Copies a segmentation confidence mask (0..1 per pixel, person = 1) into the alpha channel of
 * an RGBA buffer of the same size; colour channels are set to white.
 * @param {Float32Array} confidence
 * @param {Uint8ClampedArray} rgba  length = confidence.length * 4
 */
export function fillMaskAlpha(confidence, rgba) {
  for (let i = 0, j = 0; i < confidence.length; i++, j += 4) {
    rgba[j] = rgba[j + 1] = rgba[j + 2] = 255;
    const v = confidence[i];
    rgba[j + 3] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }
  return rgba;
}

/** Segmentation runs at most ~15 times a second, ~10 when the device is slow (>20 ms a run). */
export function nextInterval(lastRunMs) {
  return lastRunMs > 20 ? 100 : 66;
}

/**
 * MediaPipe's tasks bundle has built-in usage logging to Google that can't be switched off.
 * The extension only ever talks to ClickUp, so those requests are refused before they are made
 * (and the extension's CSP connect-src would block them anyway).
 */
export function isBlockedTelemetry(url) {
  try {
    return new URL(String(url)).hostname === 'odml.pa.googleapis.com';
  } catch {
    return false;
  }
}
