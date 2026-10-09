// lib/capture-session.js with a fake recorder and a fake IndexedDB: the same host logic
// serves Chrome's offscreen document and the Firefox sidebar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureSession, recoverInterruptedRecording } from '../../lib/capture-session.js';

function fakeRecorder({ micError } = {}) {
  let recording = false;
  const recorder = {
    calls: [],
    onAutoStop: null,
    isRecording: () => recording,
    async start(opts) {
      recorder.calls.push(['start', opts]);
      recording = true;
      return { micError };
    },
    async stop() {
      recorder.calls.push(['stop']);
      recording = false;
      return { file: new File(['webm'], 'recording.webm', { type: 'video/webm' }), durationMs: 1234 };
    },
  };
  return recorder;
}

function fakeSave({ fail = false } = {}) {
  const saved = [];
  const save = async (file, extra) => {
    if (fail) throw new Error('quota exceeded');
    saved.push({ file, extra });
    return saved.length; // the record id
  };
  save.saved = saved;
  return save;
}

/** Records when the chunks were released relative to the save (Firefox needs save first). */
function fakeSink(save) {
  const sink = { released: 0, releasedAfterSave: null };
  sink.release = async () => {
    sink.released++;
    sink.releasedAfterSave = save.saved.length > 0;
  };
  return sink;
}

test('start passes only the recorder options through and reports a mic failure by name', async () => {
  const recorder = fakeRecorder({ micError: Object.assign(new Error('denied'), { name: 'NotAllowedError' }) });
  const save = fakeSave();
  const session = createCaptureSession({ recorder, save, sink: fakeSink(save) });

  const res = await session.start({ type: 'rec:start', target: 'host', source: 'window', resolution: '720', micDeviceId: 'mic-1' });

  assert.deepEqual(res, { ok: true, micError: 'NotAllowedError' });
  assert.deepEqual(recorder.calls, [['start', { source: 'window', resolution: '720', micDeviceId: 'mic-1' }]]);
  assert.equal(session.isRecording(), true);
});

test('stop saves the recording as a pending attachment, then releases the chunks', async () => {
  const recorder = fakeRecorder();
  const save = fakeSave();
  const sink = fakeSink(save);
  const session = createCaptureSession({ recorder, save, sink });
  await session.start({});

  assert.deepEqual(await session.stop(), { ok: true });
  assert.equal(session.isRecording(), false);
  assert.equal(save.saved.length, 1);
  assert.equal(save.saved[0].file.name, 'recording.webm');
  assert.equal(save.saved[0].extra, undefined);
  assert.equal(sink.released, 1);
  assert.equal(sink.releasedAfterSave, true, 'Firefox blobs die with their chunk records: save must come first');
});

test('a failed save keeps the chunks on disk', async () => {
  const recorder = fakeRecorder();
  const save = fakeSave({ fail: true });
  const sink = fakeSink(save);
  const session = createCaptureSession({ recorder, save, sink });
  await session.start({});

  await assert.rejects(session.stop(), /quota exceeded/);
  assert.equal(sink.released, 0);
});

test('screenshot saves a draft for the editor and returns its id', async () => {
  const save = fakeSave();
  const session = createCaptureSession({
    recorder: fakeRecorder(),
    save,
    sink: fakeSink(save),
    frame: async (name) => new File([], name, { type: 'image/png' }),
    fileName: () => 'shot.png',
  });

  assert.deepEqual(await session.screenshot(), { ok: true, draftId: 1 });
  assert.equal(save.saved[0].file.name, 'shot.png');
  assert.deepEqual(save.saved[0].extra, { draft: true });
});

test('ending sharing from the browser bar saves the file, releases the chunks and reports back', async () => {
  const recorder = fakeRecorder();
  const save = fakeSave();
  const sink = fakeSink(save);
  const finished = [];
  createCaptureSession({ recorder, save, sink, onFinished: (r) => finished.push(r) });

  await recorder.onAutoStop({ file: new File(['x'], 'auto.webm', { type: 'video/webm' }), durationMs: 10 });

  assert.equal(save.saved[0].file.name, 'auto.webm');
  assert.deepEqual(finished, [{ error: undefined }]);
  assert.equal(sink.releasedAfterSave, true);
});

test('a save failure after the browser bar stop is reported as an error', async () => {
  const recorder = fakeRecorder();
  const save = fakeSave({ fail: true });
  const finished = [];
  createCaptureSession({ recorder, save, sink: fakeSink(save), onFinished: (r) => finished.push(r) });

  await recorder.onAutoStop({ file: new File(['x'], 'auto.webm'), durationMs: 10 });

  assert.equal(finished.length, 1);
  assert.match(finished[0].error, /quota exceeded/);
});

test('handle routes messages and answers rec:ping only while recording', async () => {
  const save = fakeSave();
  const session = createCaptureSession({ recorder: fakeRecorder(), save, sink: fakeSink(save) });

  assert.equal(session.handle({ type: 'rec:ping' }), null, 'an idle host must leave the channel to a recording one');
  assert.deepEqual(await session.handle({ type: 'rec:start', source: 'screen' }), { ok: true, micError: undefined });
  assert.deepEqual(await session.handle({ type: 'rec:ping' }), { ok: true, recording: true });
  assert.deepEqual(await session.handle({ type: 'rec:stop' }), { ok: true });
  assert.deepEqual(await session.handle({ type: 'nope' }), { ok: false, error: 'Unknown message nope' });
});

// ---- Interrupted-recording recovery (Firefox: the sidebar hosting the recorder was closed) ----

function fakeChunks(blobs) {
  let chunks = [...blobs];
  return {
    list: async () => [...chunks],
    clear: async () => {
      chunks = [];
    },
    remaining: () => chunks.length,
  };
}

test('recovery: nothing on disk → nothing to do', async () => {
  const db = fakeChunks([]);
  const save = fakeSave();
  assert.equal(await recoverInterruptedRecording({ ...db, save, hostAlive: async () => false }), null);
  assert.equal(save.saved.length, 0);
});

test('recovery: a sidebar in another window is still recording → leave its chunks alone', async () => {
  const db = fakeChunks([new Blob(['a'], { type: 'video/webm;codecs=vp8,opus' })]);
  const save = fakeSave();
  assert.equal(await recoverInterruptedRecording({ ...db, save, hostAlive: async () => true }), null);
  assert.equal(db.remaining(), 1);
  assert.equal(save.saved.length, 0);
});

test('recovery: assembles the chunks into a webm attachment and clears them', async () => {
  const db = fakeChunks([
    new Blob(['head'], { type: 'video/webm;codecs=vp8,opus' }),
    new Blob(['tail'], { type: 'video/webm;codecs=vp8,opus' }),
  ]);
  const save = fakeSave();

  const file = await recoverInterruptedRecording({ ...db, save, hostAlive: async () => false, name: 'recovered.webm' });

  assert.equal(file.name, 'recovered.webm');
  assert.equal(file.type, 'video/webm');
  assert.equal(await file.text(), 'headtail');
  assert.equal(save.saved[0].file, file);
  assert.equal(db.remaining(), 0);
});

test('recovery: untyped chunks still produce a webm file', async () => {
  const db = fakeChunks([new Blob(['x'])]);
  const file = await recoverInterruptedRecording({ ...db, save: fakeSave(), hostAlive: async () => false });
  assert.equal(file.type, 'video/webm');
  assert.match(file.name, /^recording-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.webm$/);
});
