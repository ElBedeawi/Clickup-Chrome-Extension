import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normRect, localDateToMs } from '../../lib/geometry.js';

describe('normRect (editor crop/blur selections)', () => {
  const bounds = { x: 0, y: 0, w: 1000, h: 600 };

  test('keeps a normal drag as-is', () => {
    assert.deepEqual(normRect({ x: 10, y: 20, w: 100, h: 50 }, bounds), { x: 10, y: 20, w: 100, h: 50 });
  });

  test('handles dragging up and to the left (negative size)', () => {
    assert.deepEqual(normRect({ x: 110, y: 70, w: -100, h: -50 }, bounds), { x: 10, y: 20, w: 100, h: 50 });
  });

  test('clamps to the bounds', () => {
    assert.deepEqual(normRect({ x: -50, y: 550, w: 200, h: 200 }, bounds), { x: 0, y: 550, w: 150, h: 50 });
  });

  test('clamps to an offset crop region', () => {
    const crop = { x: 100, y: 100, w: 200, h: 200 };
    assert.deepEqual(normRect({ x: 50, y: 150, w: 400, h: 20 }, crop), { x: 100, y: 150, w: 200, h: 20 });
  });

  test('rounds to whole pixels', () => {
    assert.deepEqual(normRect({ x: 10.4, y: 10.6, w: 20.2, h: 20.2 }, bounds), { x: 10, y: 11, w: 21, h: 20 });
  });

  test('a selection outside the bounds collapses to zero size', () => {
    const r = normRect({ x: 2000, y: 2000, w: 10, h: 10 }, bounds);
    assert.equal(r.w, 0);
    assert.equal(r.h, 0);
  });
});

describe('localDateToMs (due dates)', () => {
  test('date-only values land on local noon of that day', () => {
    const d = new Date(localDateToMs('2026-10-14'));
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 9, 14, 12, 0]);
  });

  test('date + time uses that local time', () => {
    const d = new Date(localDateToMs('2026-10-14', '09:30'));
    assert.deepEqual([d.getDate(), d.getHours(), d.getMinutes()], [14, 9, 30]);
  });
});

import { bubbleRect, coverFitSource, snapToCorner, BUBBLE_SIZES, BUBBLE_MARGIN } from '../../lib/geometry.js';

describe('bubbleRect (camera bubble placement)', () => {
  const W = 1920;
  const H = 1080;
  const r = (BUBBLE_SIZES.md * H) / 2;
  const m = BUBBLE_MARGIN * H;
  /** Canvas coordinates are floats; compare to a thousandth of a pixel. */
  const near = (actual, expected) => {
    for (const k of Object.keys(expected)) {
      assert.ok(Math.abs(actual[k] - expected[k]) < 1e-3, `${k}: ${actual[k]} ≠ ${expected[k]}`);
    }
  };

  test('the four corners sit one margin away from the edges', () => {
    near(bubbleRect({ canvasW: W, canvasH: H, layout: { x: 0, y: 0, size: 'md' } }), { x: m + r, y: m + r, r });
    near(bubbleRect({ canvasW: W, canvasH: H, layout: { x: 1, y: 1, size: 'md' } }), { x: W - m - r, y: H - m - r, r });
    near(bubbleRect({ canvasW: W, canvasH: H, layout: { x: 1, y: 0, size: 'md' } }), { x: W - m - r, y: m + r, r });
    near(bubbleRect({ canvasW: W, canvasH: H, layout: { x: 0, y: 1, size: 'md' } }), { x: m + r, y: H - m - r, r });
  });

  test('0.5/0.5 is the centre', () => {
    const b = bubbleRect({ canvasW: W, canvasH: H, layout: { x: 0.5, y: 0.5 } });
    assert.equal(b.x, W / 2);
    assert.equal(b.y, H / 2);
  });

  test('size scales with the shorter side, on landscape and portrait canvases', () => {
    assert.equal(bubbleRect({ canvasW: W, canvasH: H, layout: { x: 0, y: 0, size: 'sm' } }).r, (BUBBLE_SIZES.sm * H) / 2);
    assert.equal(bubbleRect({ canvasW: H, canvasH: W, layout: { x: 0, y: 0, size: 'lg' } }).r, (BUBBLE_SIZES.lg * H) / 2);
    assert.equal(bubbleRect({ canvasW: W, canvasH: H, layout: { x: 0, y: 0, size: 0.5 } }).r, H / 4, 'a numeric size is a fraction');
    assert.equal(bubbleRect({ canvasW: W, canvasH: H, layout: { x: 0, y: 0 } }).r, r, 'md is the default');
  });

  test('out-of-range positions are clamped inside the canvas', () => {
    near(bubbleRect({ canvasW: W, canvasH: H, layout: { x: 7, y: -3, size: 'md' } }), { x: W - m - r, y: m + r, r });
    assert.deepEqual(bubbleRect({ canvasW: W, canvasH: H, layout: { x: NaN, y: undefined } }), bubbleRect({ canvasW: W, canvasH: H, layout: { x: 0, y: 0 } }));
  });

  test('a canvas too small for the bubble puts it in the centre, never off-canvas', () => {
    const b = bubbleRect({ canvasW: 10, canvasH: 10, layout: { x: 1, y: 1, size: 1 } });
    assert.deepEqual(b, { x: 5, y: 5, r: 5 });
  });
});

describe('coverFitSource (object-fit: cover crop for the bubble)', () => {
  test('a wider source is cropped on the sides', () => {
    assert.deepEqual(coverFitSource(640, 480, 200, 200), { sx: 80, sy: 0, sw: 480, sh: 480 });
  });

  test('a taller source is cropped top and bottom', () => {
    assert.deepEqual(coverFitSource(480, 640, 200, 200), { sx: 0, sy: 80, sw: 480, sh: 480 });
  });

  test('a matching aspect ratio uses the whole source', () => {
    assert.deepEqual(coverFitSource(300, 300, 100, 100), { sx: 0, sy: 0, sw: 300, sh: 300 });
  });

  test('zero sizes give an empty rect instead of NaN', () => {
    assert.deepEqual(coverFitSource(0, 0, 100, 100), { sx: 0, sy: 0, sw: 0, sh: 0 });
    assert.deepEqual(coverFitSource(640, 480, 0, 100), { sx: 0, sy: 0, sw: 0, sh: 0 });
  });
});

describe('snapToCorner (bubble stage drag)', () => {
  test('snaps when close to a corner', () => {
    assert.deepEqual(snapToCorner({ x: 0.05, y: 0.96 }), { x: 0, y: 1 });
    assert.deepEqual(snapToCorner({ x: 0.93, y: 0.02 }), { x: 1, y: 0 });
  });

  test('leaves other positions alone (clamped)', () => {
    assert.deepEqual(snapToCorner({ x: 0.5, y: 0.5 }), { x: 0.5, y: 0.5 });
    assert.deepEqual(snapToCorner({ x: 0.2, y: 0.9 }), { x: 0.2, y: 0.9 });
    assert.deepEqual(snapToCorner({ x: 1.4, y: 0.5 }), { x: 1, y: 0.5 });
  });

  test('honours a custom threshold', () => {
    assert.deepEqual(snapToCorner({ x: 0.2, y: 0.2 }, 0.25), { x: 0, y: 0 });
    assert.deepEqual(snapToCorner({ x: 0.2, y: 0.2 }, 0.1), { x: 0.2, y: 0.2 });
  });
});
