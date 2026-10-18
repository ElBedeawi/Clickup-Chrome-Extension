import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installChrome } from '../helpers/chrome-stub.mjs';
import { getPrefs } from '../../lib/storage.js';
import { clipFormFields, parseHandshake, clipsHubUrl, clipError, clipsEligible, setClipsPrefs, clearShard, MAX_CLIP_BYTES } from '../../lib/clickup-clips.js';

beforeEach(() => {
  installChrome();
});

test('clipFormFields marks a workspace Clip the way the web app does', () => {
  assert.deepEqual(clipFormFields(37401264), { type: '7', parent: '37401264', permanent: 'true', clip: 'true' });
});

test('parseHandshake reads the per-workspace API host and rejects odd shapes', () => {
  const json = { workspaceId: '1', shardId: 'prod-eu-west-1-3', appEnvironment: { apiUrlBase: 'https://frontdoor-prod-eu-west-1-3.clickup.com' } };
  assert.equal(parseHandshake(json), 'https://frontdoor-prod-eu-west-1-3.clickup.com');
  assert.equal(parseHandshake({}), null);
  assert.equal(parseHandshake({ appEnvironment: { apiUrlBase: 'http://insecure' } }), null);
  assert.equal(parseHandshake(null), null);
});

test('clipsHubUrl points at the workspace Clips Hub', () => {
  assert.equal(clipsHubUrl('42'), 'https://app.clickup.com/42/hubs/clips');
});

test('clipsEligible accepts videos under the size cap and explains refusals', () => {
  const file = (type, size) => ({ type, size, name: 'f' });
  assert.deepEqual(clipsEligible(file('video/webm', 1024)), { ok: true });
  assert.match(clipsEligible(file('image/png', 1024)).reason, /Only videos/);
  assert.match(clipsEligible(file('', 1024)).reason, /Only videos/);
  assert.match(clipsEligible(file('video/webm', MAX_CLIP_BYTES + 1)).reason, /over 45 MB/);
  assert.deepEqual(clipsEligible(file('video/webm', 10), { maxBytes: 100 }), { ok: true });
  assert.equal(clipsEligible(undefined).ok, false);
});

test('setClipsPrefs merges into prefs.clips: autoSave and the shard cache leave each other alone', async () => {
  await setClipsPrefs({ shards: { 42: { base: 'https://frontdoor-x.clickup.com', at: 1 } } });
  await setClipsPrefs({ autoSave: true });
  assert.deepEqual((await getPrefs()).clips, { autoSave: true, shards: { 42: { base: 'https://frontdoor-x.clickup.com', at: 1 } } });
  await clearShard('42');
  assert.deepEqual((await getPrefs()).clips, { autoSave: true, shards: {} });
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
