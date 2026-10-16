// Pure helpers shared by the UI (kept DOM-free so they can be unit-tested in Node).

/** Normalizes a dragged rect (may have negative w/h), clamps it to `bounds`, rounds to pixels. */
export function normRect(r, bounds) {
  let x1 = Math.min(r.x, r.x + r.w);
  let y1 = Math.min(r.y, r.y + r.h);
  let x2 = Math.max(r.x, r.x + r.w);
  let y2 = Math.max(r.y, r.y + r.h);
  x1 = Math.max(bounds.x, Math.round(x1));
  y1 = Math.max(bounds.y, Math.round(y1));
  x2 = Math.min(bounds.x + bounds.w, Math.round(x2));
  y2 = Math.min(bounds.y + bounds.h, Math.round(y2));
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

/**
 * `<input type="date">` value (+ optional `<input type="time">` value) → unix ms in local time.
 * Date-only values use local noon, so timezone differences can't shift the day.
 */
export function localDateToMs(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  if (!time) return new Date(y, m - 1, d, 12, 0).getTime();
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

// ---- Camera bubble (lib/compositor.js draws it; sidepanel/bubble-stage.js previews it) ----

/** Bubble diameter as a fraction of the shorter canvas side. */
export const BUBBLE_SIZES = { sm: 0.14, md: 0.2, lg: 0.28 };
/** Gap between the bubble and the canvas edge, as a fraction of the shorter side. */
export const BUBBLE_MARGIN = 0.02;
export const BUBBLE_CORNERS = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * Where the camera bubble goes on a canvas. `layout.x`/`.y` are fractions of the area the
 * bubble may occupy (margin already excluded), so the four corners are exactly 0/1 pairs.
 * @param {{ canvasW: number, canvasH: number, layout: { x: number, y: number, size?: 'sm'|'md'|'lg'|number } }} opts
 * @returns {{ x: number, y: number, r: number }} centre + radius in canvas pixels
 */
export function bubbleRect({ canvasW, canvasH, layout }) {
  const short = Math.max(0, Math.min(canvasW, canvasH));
  const frac = typeof layout?.size === 'number' ? layout.size : (BUBBLE_SIZES[layout?.size] ?? BUBBLE_SIZES.md);
  const r = (frac * short) / 2;
  const m = BUBBLE_MARGIN * short;
  const spanX = canvasW - 2 * m - 2 * r;
  const spanY = canvasH - 2 * m - 2 * r;
  // Too small for margin + diameter: just centre it.
  const x = spanX > 0 ? m + r + clamp01(layout?.x) * spanX : canvasW / 2;
  const y = spanY > 0 ? m + r + clamp01(layout?.y) * spanY : canvasH / 2;
  return { x, y, r };
}

/**
 * Source crop for drawing `srcW`×`srcH` into `dstW`×`dstH` like `object-fit: cover`
 * (fill the destination, keep the aspect ratio, crop the overflow evenly).
 * @returns {{ sx: number, sy: number, sw: number, sh: number }}
 */
export function coverFitSource(srcW, srcH, dstW, dstH) {
  if (!(srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0)) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const sw = dstW / scale;
  const sh = dstH / scale;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

/** Snaps a bubble position to the nearest corner when it is within `threshold` of it. */
export function snapToCorner({ x, y }, threshold = 0.08) {
  const cx = clamp01(x);
  const cy = clamp01(y);
  for (const corner of BUBBLE_CORNERS) {
    if (Math.abs(cx - corner.x) <= threshold && Math.abs(cy - corner.y) <= threshold) return { ...corner };
  }
  return { x: cx, y: cy };
}
