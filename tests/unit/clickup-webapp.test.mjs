import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installChrome } from '../helpers/chrome-stub.mjs';
import { getPrefs } from '../../lib/storage.js';
import { setClipsPrefs } from '../../lib/clickup-clips.js';
import { parseHandshake, resolveShard, clearShard, setWebappPrefs } from '../../lib/clickup-webapp.js';

beforeEach(() => {
  installChrome();
});

const handshake = (base) => async () => ({ json: async () => ({ appEnvironment: { apiUrlBase: base } }), status: 200 });

test('parseHandshake reads the per-workspace API host and rejects odd shapes', () => {
  const json = { workspaceId: '1', shardId: 'prod-eu-west-1-3', appEnvironment: { apiUrlBase: 'https://frontdoor-prod-eu-west-1-3.clickup.com' } };
  assert.equal(parseHandshake(json), 'https://frontdoor-prod-eu-west-1-3.clickup.com');
  assert.equal(parseHandshake({}), null);
  assert.equal(parseHandshake({ appEnvironment: { apiUrlBase: 'http://insecure' } }), null);
  assert.equal(parseHandshake(null), null);
});

test('resolveShard caches the host in prefs.webapp.shards until clearShard drops it', async () => {
  let calls = 0;
  const fetchImpl = async (...args) => {
    calls++;
    return handshake('https://frontdoor-x.clickup.com')(...args);
  };
  assert.equal(await resolveShard('42', { fetchImpl }), 'https://frontdoor-x.clickup.com');
  assert.equal(await resolveShard('42', { fetchImpl }), 'https://frontdoor-x.clickup.com');
  assert.equal(calls, 1);
  assert.equal((await getPrefs()).webapp.shards['42'].base, 'https://frontdoor-x.clickup.com');
  await clearShard('42');
  assert.deepEqual((await getPrefs()).webapp, { shards: {} });
  await resolveShard('42', { fetchImpl });
  assert.equal(calls, 2);
});

test('resolveShard rejects a handshake without a usable host', async () => {
  await assert.rejects(resolveShard('42', { fetchImpl: handshake('http://insecure') }), /API host/);
});

test('webapp and clips prefs leave each other alone; the old prefs.clips.shards cache is dropped', async () => {
  installChrome({ prefs: { clips: { autoSave: false, shards: { 1: { base: 'https://old.clickup.com' } } } } });
  await setWebappPrefs({ shards: { 42: { base: 'https://frontdoor-x.clickup.com', at: 1 } } });
  await setClipsPrefs({ autoSave: true });
  const prefs = await getPrefs();
  assert.deepEqual(prefs.clips, { autoSave: true });
  assert.deepEqual(prefs.webapp, { shards: { 42: { base: 'https://frontdoor-x.clickup.com', at: 1 } } });
});
