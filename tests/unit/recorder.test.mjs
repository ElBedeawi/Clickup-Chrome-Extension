// lib/recorder.js against fake media APIs: how a recording ends must not depend on who ended
// it or in which order the browser fires its events (Chrome ends the track first; Firefox can
// stop the MediaRecorder first).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder } from '../../lib/recorder.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

class FakeTrack {
  constructor(kind) {
    this.kind = kind;
    this.readyState = 'live';
    this.listeners = {};
  }
  getSettings() {
    return { width: 1280, height: 720, frameRate: 30 };
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  stop() {
    this.readyState = 'ended';
  }
  /** What the browser does when the user clicks its "Stop sharing" control. */
  end() {
    this.readyState = 'ended';
    (this.listeners.ended || []).forEach((fn) => fn());
  }
}

class FakeStream {
  constructor(tracks) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
}

let recorders;
class FakeMediaRecorder {
  static isTypeSupported(type) {
    return type === 'video/webm;codecs=vp8,opus';
  }
  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
    this.mimeType = options.mimeType;
    this.state = 'inactive';
    this.log = [];
    recorders.push(this);
  }
  start() {
    this.log.push('start');
    this.state = 'recording';
  }
  requestData() {
    if (this.state === 'inactive') throw new DOMException('inactive', 'InvalidStateError');
    this.log.push('requestData');
    this.ondataavailable?.({ data: new Blob(['flush']) });
  }
  pause() {
    if (this.state === 'inactive') throw new DOMException('inactive', 'InvalidStateError');
    this.log.push('pause');
    this.state = 'paused';
  }
  resume() {
    if (this.state === 'inactive') throw new DOMException('inactive', 'InvalidStateError');
    this.log.push('resume');
    this.state = 'recording';
  }
  stop() {
    if (this.state === 'inactive') throw new DOMException('inactive', 'InvalidStateError');
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['last']) });
    this.onstop?.();
  }
  /** The browser stopping the recorder by itself (e.g. its tracks went away). */
  dieOnItsOwn() {
    this.state = 'inactive';
    this.onstop?.();
  }
}

let videoTrack;
let cameraTrack;
let cameraAvailable; // getUserMedia({ video }) succeeds (true) or is denied (false)
let micTrack;
let micAvailable; // getUserMedia({ audio }) succeeds (true) or finds no mic (false)
let userMediaCalls;
// Node ships a read-only `navigator` global, so swap it with a property definition.
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
beforeEach(() => {
  recorders = [];
  videoTrack = new FakeTrack('video');
  cameraTrack = new FakeTrack('video');
  cameraAvailable = true;
  micTrack = Object.assign(new FakeTrack('audio'), { enabled: true });
  micAvailable = false;
  userMediaCalls = [];
  globalThis.MediaRecorder = FakeMediaRecorder;
  globalThis.MediaStream = FakeStream;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getDisplayMedia: async () => new FakeStream([videoTrack]),
        getUserMedia: async (constraints) => {
          userMediaCalls.push(constraints);
          if (constraints.video) {
            if (cameraAvailable) return new FakeStream([cameraTrack]);
            throw Object.assign(new Error('camera denied'), { name: 'NotAllowedError' });
          }
          if (micAvailable) return new FakeStream([micTrack]);
          throw Object.assign(new Error('no mic in tests'), { name: 'NotFoundError' });
        },
      },
    },
  });
});
afterEach(() => {
  delete globalThis.MediaRecorder;
  delete globalThis.MediaStream;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete globalThis.navigator;
});

/** Stands in for lib/compositor.js (Node has no canvas): records its inputs, returns its own track. */
function fakeCompositor() {
  const track = new FakeTrack('video');
  const spy = {
    calls: [],
    layouts: [],
    stops: 0,
    track,
    factory: (opts) => {
      spy.calls.push(opts);
      return {
        stream: new FakeStream([track]),
        ready: Promise.resolve(),
        setLayout: (l) => spy.layouts.push(l),
        stop: () => spy.stops++,
      };
    },
  };
  return spy;
}

function sinkSpy() {
  const chunks = [];
  return {
    chunks,
    reset: async () => chunks.splice(0),
    append: async (b) => chunks.push(b),
    assemble: async (name, type) => new File(chunks, name, { type }),
  };
}

test('stop() resolves with the assembled file and does not fire onAutoStop', async () => {
  const sink = sinkSpy();
  const recorder = createRecorder({ sink });
  const auto = [];
  recorder.onAutoStop = (r) => auto.push(r);

  const { micError } = await recorder.start({ micDeviceId: 'default' });
  assert.equal(micError.name, 'NotFoundError', 'a missing mic must not stop the recording');
  assert.equal(recorder.isRecording(), true);

  const { file } = await recorder.stop();
  assert.match(file.name, /^recording-.*\.webm$/);
  assert.equal(file.type, 'video/webm');
  assert.equal(recorder.isRecording(), false);
  assert.equal(videoTrack.readyState, 'ended', 'tracks are released');
  await tick();
  assert.deepEqual(auto, []);
  assert.equal((await recorder.stop()).file, file, 'a repeated stop() is idempotent');
});

test('stop() without a recording rejects', async () => {
  const recorder = createRecorder({ sink: sinkSpy() });
  await assert.rejects(recorder.stop(), /Not recording/);
});

test('Chrome order: the track ends first → the recorder is stopped and onAutoStop fires once', async () => {
  const recorder = createRecorder({ sink: sinkSpy() });
  const auto = [];
  recorder.onAutoStop = (r) => auto.push(r);
  await recorder.start({ micDeviceId: null });

  videoTrack.end();
  await tick();

  assert.equal(auto.length, 1);
  assert.ok(auto[0].file instanceof File);
  assert.equal(recorders[0].state, 'inactive');
  assert.equal(recorder.isRecording(), false);
});

test('Firefox order: the recorder goes inactive first, then the track ends → still saved once', async () => {
  const recorder = createRecorder({ sink: sinkSpy() });
  const auto = [];
  recorder.onAutoStop = (r) => auto.push(r);
  await recorder.start({ micDeviceId: null });

  recorders[0].dieOnItsOwn();
  await tick();
  videoTrack.end(); // must not throw on the already-inactive recorder, nor save twice
  await tick();

  assert.equal(auto.length, 1);
  assert.ok(auto[0].file instanceof File);
  assert.equal(recorder.isRecording(), false);
});

test('an assemble failure on an automatic stop is reported, not swallowed', async () => {
  const sink = sinkSpy();
  sink.assemble = async () => {
    throw new Error('disk full');
  };
  const recorder = createRecorder({ sink });
  const auto = [];
  recorder.onAutoStop = (r) => auto.push(r);
  await recorder.start({ micDeviceId: null });

  videoTrack.end();
  await tick();

  assert.equal(auto.length, 1);
  assert.equal(auto[0].file, undefined);
  assert.match(auto[0].error.message, /disk full/);
});

test('a second recording after an automatic stop starts clean', async () => {
  const recorder = createRecorder({ sink: sinkSpy() });
  recorder.onAutoStop = () => {};
  await recorder.start({ micDeviceId: null });
  videoTrack.end();
  await tick();

  videoTrack = new FakeTrack('video');
  await recorder.start({ micDeviceId: null });
  assert.equal(recorder.isRecording(), true);
  const { file } = await recorder.stop();
  assert.ok(file instanceof File);
});

// ---- Camera bubble ----

test('without a camera the display track is recorded and the compositor is never used', async () => {
  const comp = fakeCompositor();
  const recorder = createRecorder({ sink: sinkSpy(), compositor: comp.factory });
  const res = await recorder.start({ micDeviceId: null });

  assert.equal(res.cameraError, undefined);
  assert.deepEqual(comp.calls, []);
  assert.equal(recorders[0].stream.getVideoTracks()[0], videoTrack);
  assert.deepEqual(userMediaCalls, []);
  assert.equal(recorder.setBubble({ x: 1, y: 1 }), false, 'nothing to move');
  await recorder.stop();
});

test('with a camera the composited track is recorded; stop releases the camera and the compositor', async () => {
  const comp = fakeCompositor();
  const recorder = createRecorder({ sink: sinkSpy(), compositor: comp.factory });
  const res = await recorder.start({ micDeviceId: null, cameraDeviceId: 'cam-1', bubble: { x: 1, y: 0, size: 'lg' } });

  assert.equal(res.cameraError, undefined);
  assert.equal(userMediaCalls.length, 1);
  assert.deepEqual(userMediaCalls[0].video.deviceId, { exact: 'cam-1' });
  assert.equal(userMediaCalls[0].audio, false);
  assert.equal(comp.calls.length, 1);
  assert.equal(comp.calls[0].displayStream.getVideoTracks()[0], videoTrack);
  assert.equal(comp.calls[0].cameraStream.getVideoTracks()[0], cameraTrack);
  assert.deepEqual(comp.calls[0].layout, { x: 1, y: 0, size: 'lg' });
  assert.equal(recorders[0].stream.getVideoTracks()[0], comp.track, 'the canvas track goes to MediaRecorder');
  assert.equal(recorders[0].options.videoBitsPerSecond, Math.round(1280 * 720 * 30 * 0.1), 'bitrate still follows the display track');

  assert.equal(recorder.setBubble({ x: 0.5, y: 0.5 }), true);
  assert.deepEqual(comp.layouts, [{ x: 0.5, y: 0.5 }]);

  await recorder.stop();
  assert.equal(comp.stops, 1);
  assert.equal(cameraTrack.readyState, 'ended');
  assert.equal(videoTrack.readyState, 'ended');
});

test('a denied camera is reported and the recording goes on without a bubble', async () => {
  cameraAvailable = false;
  const comp = fakeCompositor();
  const recorder = createRecorder({ sink: sinkSpy(), compositor: comp.factory });
  const res = await recorder.start({ micDeviceId: null, cameraDeviceId: 'cam-1' });

  assert.equal(res.cameraError.name, 'NotAllowedError');
  assert.equal(recorder.isRecording(), true);
  assert.deepEqual(comp.calls, []);
  assert.equal(recorders[0].stream.getVideoTracks()[0], videoTrack);
  await recorder.stop();
});

test('"Stop sharing" while compositing still ends the recording once and stops the compositor', async () => {
  const comp = fakeCompositor();
  const recorder = createRecorder({ sink: sinkSpy(), compositor: comp.factory });
  const auto = [];
  recorder.onAutoStop = (r) => auto.push(r);
  await recorder.start({ micDeviceId: null, cameraDeviceId: 'default' });
  assert.equal(userMediaCalls[0].video.deviceId, undefined, '"default" leaves the device choice to the browser');

  videoTrack.end(); // the display track, not the canvas track, is what the browser ends
  await tick();

  assert.equal(auto.length, 1);
  assert.ok(auto[0].file instanceof File);
  assert.equal(comp.stops, 1);
  assert.equal(cameraTrack.readyState, 'ended');
  assert.equal(recorder.setBubble({ x: 0 }), false);
});

// ---- Pause / resume ----

test('pause and resume keep the recording going; paused still counts as recording', async () => {
  const recorder = createRecorder({ sink: sinkSpy() });
  const changes = [];
  recorder.onChange = (s) => changes.push(s);
  await recorder.start({ micDeviceId: null });

  recorder.pause();
  assert.equal(recorder.status().state, 'paused');
  assert.equal(recorder.isRecording(), true, 'a paused clip must not be recovered as interrupted, nor routed elsewhere');
  assert.ok(recorder.status().pausedAt > 0);
  recorder.pause(); // idempotent: two panels clicking at once
  assert.deepEqual(recorders[0].log, ['start', 'requestData', 'pause'], 'the last timeslice is flushed to disk first');

  recorder.resume();
  recorder.resume();
  const status = recorder.status();
  assert.equal(status.state, 'recording');
  assert.equal(status.pausedAt, null);
  assert.ok(status.pausedMs >= 0);
  assert.deepEqual(recorders[0].log, ['start', 'requestData', 'pause', 'resume']);
  assert.deepEqual(changes.map((s) => s.state), ['paused', 'recording'], 'one change per real transition');
  await recorder.stop();
});

test('pause and resume refuse when nothing is recording', async () => {
  const recorder = createRecorder({ sink: sinkSpy() });
  assert.throws(() => recorder.pause(), /Not recording/);
  assert.throws(() => recorder.resume(), /Not paused/);
});

test('stopping while paused saves the clip, including the flushed chunk', async () => {
  const sink = sinkSpy();
  const recorder = createRecorder({ sink });
  await recorder.start({ micDeviceId: null });
  recorder.pause();

  const { file } = await recorder.stop();
  assert.equal(await file.text(), 'flushlast');
  assert.equal(recorder.isRecording(), false);
});

test('"Stop sharing" while paused still ends and saves the recording once', async () => {
  const recorder = createRecorder({ sink: sinkSpy() });
  const auto = [];
  recorder.onAutoStop = (r) => auto.push(r);
  await recorder.start({ micDeviceId: null });
  recorder.pause();

  videoTrack.end();
  await tick();

  assert.equal(auto.length, 1);
  assert.ok(auto[0].file instanceof File);
  assert.equal(recorder.isRecording(), false);
});

// ---- Countdown ----

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('with a countdown, sharing is set up at once but recording starts when it runs out', async () => {
  const recorder = createRecorder({ sink: sinkSpy() });
  const changes = [];
  recorder.onChange = (s) => changes.push(s);
  const before = Date.now();
  await recorder.start({ micDeviceId: null, delayMs: 30 });

  const status = recorder.status();
  assert.equal(status.state, 'countdown');
  assert.ok(status.startedAt >= before + 30, 'startedAt is the planned start, in the future');
  assert.equal(recorder.isRecording(), true, 'a second start must be refused during the countdown');
  await assert.rejects(recorder.start({ micDeviceId: null }), /Already recording/);
  assert.deepEqual(recorders[0].log, [], 'nothing recorded yet');
  assert.throws(() => recorder.pause(), /Not recording/, 'no pausing a clip that has not started');

  await wait(60);
  assert.deepEqual(recorders[0].log, ['start']);
  assert.equal(recorder.status().state, 'recording');
  assert.equal(changes.length, 1, 'the host is told when the countdown ran out');
  assert.equal(changes[0].state, 'recording');
  await recorder.stop();
});

test('stop() during the countdown cancels: no file, nothing recorded, devices released', async () => {
  const recorder = createRecorder({ sink: sinkSpy() });
  const auto = [];
  recorder.onAutoStop = (r) => auto.push(r);
  await recorder.start({ micDeviceId: null, delayMs: 30 });

  assert.deepEqual(await recorder.stop(), { file: null, durationMs: 0, cancelled: true });
  assert.equal(recorder.isRecording(), false);
  assert.equal(videoTrack.readyState, 'ended');
  await wait(60);
  assert.deepEqual(recorders[0].log, [], 'the cancelled timer must not start the recorder later');
  assert.deepEqual(auto, []);
});

test('"Stop sharing" during the countdown reports a cancelled clip once', async () => {
  const recorder = createRecorder({ sink: sinkSpy() });
  const auto = [];
  recorder.onAutoStop = (r) => auto.push(r);
  await recorder.start({ micDeviceId: null, delayMs: 30 });

  videoTrack.end();
  await wait(60);

  assert.deepEqual(auto, [{ file: null, durationMs: 0, cancelled: true }]);
  assert.deepEqual(recorders[0].log, []);
  assert.equal(recorder.isRecording(), false);
});

// ---- Mute ----

test('muting disables the mic track (silence) without ending it, and reports the change', async () => {
  micAvailable = true;
  const recorder = createRecorder({ sink: sinkSpy() });
  const changes = [];
  recorder.onChange = (s) => changes.push(s);
  await recorder.start({ micDeviceId: 'default' });
  assert.equal(recorder.status().mic, true);
  assert.ok(recorders[0].stream.getAudioTracks().includes(micTrack));

  assert.equal(recorder.setMicMuted(true), true);
  assert.equal(micTrack.enabled, false);
  assert.equal(micTrack.readyState, 'live');
  assert.equal(recorder.status().micMuted, true);
  assert.equal(recorder.setMicMuted(false), true);
  assert.equal(micTrack.enabled, true);
  assert.deepEqual(changes.map((s) => s.micMuted), [true, false]);
  await recorder.stop();
});

// ---- Background blur ----

/** Stands in for lib/background-blur.js createBlurrer: records its life, can fail to load. */
function fakeBlurrers({ fail = false, events = [] } = {}) {
  const made = [];
  const factory = ({ level }) => {
    events.push(`blurrer:${level}`);
    const b = {
      level,
      closed: 0,
      ready: fail ? Promise.reject(new Error('no WebGL here')) : Promise.resolve(),
      close: () => b.closed++,
    };
    b.ready.catch(() => {});
    made.push(b);
    return b;
  };
  return { factory, made, events };
}

test('blur: the segmenter starts loading before the picker and goes to the compositor', async () => {
  const comp = fakeCompositor();
  const blur = fakeBlurrers();
  const pick = navigator.mediaDevices.getDisplayMedia;
  navigator.mediaDevices.getDisplayMedia = async (...a) => (blur.events.push('picker'), pick(...a));
  const recorder = createRecorder({ sink: sinkSpy(), compositor: comp.factory, blurrer: blur.factory });

  const res = await recorder.start({ micDeviceId: null, cameraDeviceId: 'cam-1', blur: 'medium' });

  assert.equal(res.blurError, undefined);
  assert.deepEqual(blur.events, ['blurrer:medium', 'picker'], 'loads while the user is in the picker');
  assert.equal(comp.calls[0].blurrer, blur.made[0]);
  assert.equal(recorder.status().blur, 'medium');
  await recorder.stop();
  assert.equal(blur.made[0].closed, 1, 'freed with the recording');
});

test('blur that cannot start leaves the camera out instead of recording the background (fail closed)', async () => {
  const comp = fakeCompositor();
  const blur = fakeBlurrers({ fail: true });
  const recorder = createRecorder({ sink: sinkSpy(), compositor: comp.factory, blurrer: blur.factory });

  const res = await recorder.start({ micDeviceId: null, cameraDeviceId: 'cam-1', blur: 'high' });

  assert.match(res.blurError.message, /no WebGL/);
  assert.deepEqual(comp.calls, [], 'no bubble at all');
  assert.equal(cameraTrack.readyState, 'ended', 'the camera is released');
  assert.equal(recorders[0].stream.getVideoTracks()[0], videoTrack, 'the screen alone is recorded');
  assert.equal(recorder.status().blur, 'none');
  assert.equal(recorder.isRecording(), true, 'the recording itself goes on');
  assert.equal(blur.made[0].closed, 1);
  await recorder.stop();
});

test('blur is not loaded without a camera or at "none", and is freed if the picker is cancelled', async () => {
  const blur = fakeBlurrers();
  const recorder = createRecorder({ sink: sinkSpy(), compositor: fakeCompositor().factory, blurrer: blur.factory });
  await recorder.start({ micDeviceId: null, blur: 'medium' });
  await recorder.stop();
  videoTrack = new FakeTrack('video');
  await recorder.start({ micDeviceId: null, cameraDeviceId: 'cam-1', blur: 'none' });
  await recorder.stop();
  assert.deepEqual(blur.made, []);

  navigator.mediaDevices.getDisplayMedia = async () => {
    throw Object.assign(new Error('cancelled'), { name: 'NotAllowedError' });
  };
  await assert.rejects(recorder.start({ micDeviceId: null, cameraDeviceId: 'cam-1', blur: 'high' }), /cancelled/);
  assert.equal(blur.made.length, 1);
  assert.equal(blur.made[0].closed, 1);
});

test('without a mic there is nothing to mute', async () => {
  const recorder = createRecorder({ sink: sinkSpy() });
  await recorder.start({ micDeviceId: 'default' }); // no mic in this test
  assert.equal(recorder.status().mic, false);
  assert.equal(recorder.setMicMuted(true), false);
  await recorder.stop();
});
