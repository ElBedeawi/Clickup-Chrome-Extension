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
    this.mimeType = options.mimeType;
    this.state = 'inactive';
    recorders.push(this);
  }
  start() {
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
// Node ships a read-only `navigator` global, so swap it with a property definition.
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
beforeEach(() => {
  recorders = [];
  videoTrack = new FakeTrack('video');
  globalThis.MediaRecorder = FakeMediaRecorder;
  globalThis.MediaStream = FakeStream;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getDisplayMedia: async () => new FakeStream([videoTrack]),
        getUserMedia: async () => {
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
