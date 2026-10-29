import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installChrome } from '../helpers/chrome-stub.mjs';
import { getPrefs } from '../../lib/storage.js';
import { clipFormFields, clipsHubUrl, clipError, clipsEligible, setClipsPrefs } from '../../lib/clickup-clips.js';

beforeEach(() => {
  installChrome();
});

test('clipFormFields marks a workspace Clip the way the web app does', () => {
  assert.deepEqual(clipFormFields(37401264), { type: '7', parent: '37401264', permanent: 'true', clip: 'true' });
});

test('clipsHubUrl points at the workspace Clips Hub', () => {
  assert.equal(clipsHubUrl('42'), 'https://app.clickup.com/42/hubs/clips');
});

test('clipsEligible accepts any video and explains refusals', () => {
  const file = (type, size) => ({ type, size, name: 'f' });
  assert.deepEqual(clipsEligible(file('video/webm', 1024)), { ok: true });
  assert.match(clipsEligible(file('image/png', 1024)).reason, /Only videos/);
  assert.match(clipsEligible(file('', 1024)).reason, /Only videos/);
  assert.deepEqual(clipsEligible(file('video/webm', 2 * 1024 ** 3)), { ok: true }); // no size cap of our own
  assert.equal(clipsEligible(undefined).ok, false);
});

test('setClipsPrefs merges into prefs.clips without clobbering its other keys', async () => {
  await setClipsPrefs({ autoSave: true });
  await setClipsPrefs({ other: 1 });
  assert.deepEqual((await getPrefs()).clips, { autoSave: true, other: 1 });
});

test('clipError turns private-API failures into actionable messages', () => {
  assert.match(clipError(401, {}).message, /Sign in to ClickUp/);
  assert.match(clipError(400, { err: 'Auth header missing', ECODE: 'JWT_008' }).message, /Sign in to ClickUp/);
  assert.match(clipError(403, {}).message, /doesn't allow Clips/);
  assert.match(clipError(500, { ECODE: 'GBUSED_005' }).message, /out of storage/);
  assert.equal(clipError(500, { err: 'boom' }).message, 'boom');
  assert.equal(clipError(502, null).message, 'Clip upload failed (HTTP 502).');
  assert.equal(clipError(401, {}).status, 401);
});
