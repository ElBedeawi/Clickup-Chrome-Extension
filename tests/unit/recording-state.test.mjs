// lib/recording-state.js: what the recording strip shows for a session snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elapsedMs, countdownLeft, recordingPhase } from '../../lib/recording-state.js';

const base = { id: 1, startedAt: 10_000, camera: false, mic: true, pausedAt: null, pausedMs: 0, micMuted: false };

test('elapsed time runs from the start while recording', () => {
  assert.equal(elapsedMs(base, 25_000), 15_000);
  assert.equal(recordingPhase(base, 25_000), 'recording');
});

test('a pause freezes the time; earlier pauses are left out', () => {
  const paused = { ...base, pausedAt: 20_000, pausedMs: 3_000 };
  assert.equal(elapsedMs(paused, 20_000), 7_000);
  assert.equal(elapsedMs(paused, 90_000), 7_000, 'frozen while paused');
  assert.equal(recordingPhase(paused, 90_000), 'paused');
  const resumed = { ...base, pausedMs: 3_000 };
  assert.equal(elapsedMs(resumed, 25_000), 12_000);
});

test('the countdown counts whole seconds down to the start, and the time reads 0', () => {
  assert.equal(countdownLeft(base, 7_000), 3);
  assert.equal(countdownLeft(base, 7_001), 3);
  assert.equal(countdownLeft(base, 8_500), 2);
  assert.equal(countdownLeft(base, 9_999), 1);
  assert.equal(countdownLeft(base, 10_000), 0);
  assert.equal(elapsedMs(base, 8_000), 0);
  assert.equal(recordingPhase(base, 8_000), 'countdown');
  assert.equal(recordingPhase(base, 10_000), 'recording');
});

test('older snapshots without the pause fields still work, and no recording reads as nothing', () => {
  assert.equal(elapsedMs({ startedAt: 10_000, camera: true }, 12_000), 2_000);
  assert.equal(elapsedMs(null), 0);
  assert.equal(countdownLeft(null), 0);
  assert.equal(recordingPhase(null), null);
});
