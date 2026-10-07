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
