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
