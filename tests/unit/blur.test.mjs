// lib/blur-math.js and the telemetry guard in lib/background-blur.js (the segmenter itself runs
// in a real browser: tests/smoke/blur.html).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLUR_LEVELS, isBlurLevel, blurRadius, fillMaskAlpha, nextInterval, isBlockedTelemetry } from '../../lib/blur-math.js';
import { installTelemetryGuard } from '../../lib/background-blur.js';

test('the levels are none, medium and high, in menu order', () => {
  assert.deepEqual(BLUR_LEVELS, ['none', 'medium', 'high']);
  assert.equal(isBlurLevel('high'), true);
  assert.equal(isBlurLevel('max'), false);
  assert.equal(isBlurLevel(undefined), false);
});

test('the blur radius scales with the bubble, high is stronger, none is nothing', () => {
  assert.equal(blurRadius('none', 400), 0);
  assert.equal(blurRadius('medium', 200), 8);
  assert.equal(blurRadius('high', 200), 18);
  assert.ok(blurRadius('high', 400) > blurRadius('high', 200), 'bigger bubble, bigger radius');
  assert.equal(blurRadius('medium', 20), 3, 'never so small the background stays readable');
});

test('a confidence mask becomes the alpha channel (person opaque, background transparent)', () => {
  const rgba = new Uint8ClampedArray(4 * 4);
  fillMaskAlpha(new Float32Array([0, 0.5, 1, 1.7]), rgba);
  assert.deepEqual([...rgba], [255, 255, 255, 0, 255, 255, 255, 128, 255, 255, 255, 255, 255, 255, 255, 255]);
  fillMaskAlpha(new Float32Array([-0.2]), rgba);
  assert.equal(rgba[3], 0);
});

test('segmentation backs off from ~15 to ~10 a second on slow devices', () => {
  assert.equal(nextInterval(8), 66);
  assert.equal(nextInterval(35), 100);
});

test('only MediaPipe’s logging endpoint counts as telemetry', () => {
  assert.equal(isBlockedTelemetry('https://odml.pa.googleapis.com/v1/log'), true);
  assert.equal(isBlockedTelemetry(new URL('https://odml.pa.googleapis.com/v1/log?x=1')), true);
  assert.equal(isBlockedTelemetry('https://api.clickup.com/api/v2/team'), false);
  assert.equal(isBlockedTelemetry('chrome-extension://abc/vendor/mediapipe/wasm/vision_wasm_internal.wasm'), false);
  assert.equal(isBlockedTelemetry('not a url'), false);
});

test('the guard refuses telemetry before any request is made, and passes everything else through', async () => {
  const calls = [];
  const scope = { fetch: async (input) => (calls.push(String(input?.url ?? input)), { ok: true }) };
  installTelemetryGuard(scope);
  installTelemetryGuard(scope); // idempotent: never wraps twice

  await assert.rejects(scope.fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST' }), /only connects to ClickUp/);
  await assert.rejects(scope.fetch({ url: 'https://odml.pa.googleapis.com/v1/log' }), TypeError);
  assert.deepEqual(calls, [], 'nothing reached the network');

  await scope.fetch('https://api.clickup.com/api/v2/team');
  await scope.fetch(new URL('chrome-extension://abc/vendor/mediapipe/models/selfie_segmenter.tflite'));
  assert.deepEqual(calls, ['https://api.clickup.com/api/v2/team', 'chrome-extension://abc/vendor/mediapipe/models/selfie_segmenter.tflite']);
});
