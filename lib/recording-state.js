// Reading the recording snapshot kept in chrome.storage.session `recording` (written by
// background.js from what the recorder's host reports, see lib/capture-session.js):
// { id, startedAt, camera, mic, pausedAt, pausedMs, micMuted }. Pure, so it is unit-tested.

/** Time recorded so far: paused stretches don't count, and the countdown reads as 0. */
export function elapsedMs(recording, now = Date.now()) {
  if (!recording) return 0;
  const until = recording.pausedAt ?? now;
  return Math.max(0, until - recording.startedAt - (recording.pausedMs || 0));
}

/** Whole seconds until recording starts (3, 2, 1), or 0 once it has. */
export function countdownLeft(recording, now = Date.now()) {
  if (!recording) return 0;
  return Math.max(0, Math.ceil((recording.startedAt - now) / 1000));
}

/** 'countdown' | 'paused' | 'recording', or null without a recording. */
export function recordingPhase(recording, now = Date.now()) {
  if (!recording) return null;
  if (countdownLeft(recording, now) > 0) return 'countdown';
  return recording.pausedAt ? 'paused' : 'recording';
}
