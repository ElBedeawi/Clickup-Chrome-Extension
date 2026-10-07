import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installChrome } from '../helpers/chrome-stub.mjs';
import { getToken, setToken, clearToken, getPrefs, setPrefs, onTokenChanged } from '../../lib/storage.js';

let store;
beforeEach(() => {
  store = installChrome();
});

test('token round-trips and is trimmed', async () => {
  assert.equal(await getToken(), '');
  await setToken('  pk_abc  ');
  assert.equal(await getToken(), 'pk_abc');
});

test('prefs are merged, not replaced', async () => {
  await setPrefs({ last: { workspace: '1' } });
  await setPrefs({ recorder: { resolution: '720' } });
  assert.deepEqual(await getPrefs(), { last: { workspace: '1' }, recorder: { resolution: '720' } });
});

test('clearToken (Revoke) removes the token and the account-specific prefs', async () => {
  await setToken('pk_abc');
  await setPrefs({ last: { workspace: '1' } });
  await clearToken();
  assert.equal(await getToken(), '');
  assert.deepEqual(await getPrefs(), {});
  assert.deepEqual(store.local, {});
});

test('onTokenChanged fires on save and on revoke', async () => {
  const seen = [];
  onTokenChanged((token) => seen.push(token));
  await setToken('pk_abc');
  await setPrefs({ x: 1 }); // unrelated change: ignored
  await clearToken();
  assert.deepEqual(seen, ['pk_abc', '']);
});
