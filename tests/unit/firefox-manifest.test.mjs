// The Firefox manifest is derived from manifest.json at package time; keep the two in step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toFirefoxManifest, GECKO } from '../../scripts/lib/firefox-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const chrome = JSON.parse(read('manifest.json'));
const firefox = toFirefoxManifest(chrome);

test('drops every Chrome-only key and permission', () => {
  for (const key of ['minimum_chrome_version', 'side_panel', 'options_page']) assert.ok(!(key in firefox), `${key} leaked`);
  assert.ok(!('service_worker' in firefox.background), 'service_worker leaked');
  for (const p of ['sidePanel', 'offscreen']) assert.ok(!firefox.permissions.includes(p), `${p} leaked`);
});

test('declares the Firefox equivalents', () => {
  assert.deepEqual(firefox.background, { scripts: [chrome.background.service_worker] });
  assert.equal(firefox.sidebar_action.default_panel, chrome.side_panel.default_path);
  assert.equal(firefox.sidebar_action.default_title, chrome.action.default_title);
  assert.equal(firefox.sidebar_action.open_at_install, false);
  assert.deepEqual(firefox.options_ui, { page: chrome.options_page, open_in_tab: true });

  const { gecko } = firefox.browser_specific_settings;
  assert.equal(gecko, GECKO);
  assert.match(gecko.id, /^[a-zA-Z0-9-._]*@[a-zA-Z0-9-._]+$/, 'AMO wants an email-style id');
  assert.match(gecko.strict_min_version, /^\d+\.\d+$/);
  assert.ok(Number(gecko.strict_min_version) >= 128, 'anything below 128 (ESR) cannot receive AMO updates');
  assert.ok(gecko.data_collection_permissions.required.length > 0, 'AMO rejects submissions without a data declaration');
});

test('keeps identity, icons and host permissions identical to Chrome', () => {
  for (const key of ['manifest_version', 'name', 'short_name', 'version', 'description', 'author', 'icons', 'action', 'host_permissions']) {
    assert.deepEqual(firefox[key], chrome[key], key);
  }
  assert.deepEqual(
    firefox.permissions,
    chrome.permissions.filter((p) => !['sidePanel', 'offscreen'].includes(p)),
  );
});

test('every file the Firefox manifest references exists', () => {
  const files = [
    ...firefox.background.scripts,
    firefox.sidebar_action.default_panel,
    firefox.options_ui.page,
    ...Object.values(firefox.icons),
    ...Object.values(firefox.sidebar_action.default_icon),
  ];
  for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), `missing ${f}`);
});

test('every Firefox permission and data declaration is explained in the AMO listing', () => {
  const listing = read('store/firefox-listing.md');
  for (const p of firefox.permissions) assert.ok(listing.includes(`\`${p}\``), `store/firefox-listing.md doesn't justify ${p}`);
  for (const h of firefox.host_permissions) assert.ok(listing.includes(`\`${h}\``), `store/firefox-listing.md doesn't justify ${h}`);
  for (const d of GECKO.data_collection_permissions.required) {
    assert.ok(listing.includes(`\`${d}\``), `store/firefox-listing.md doesn't explain the ${d} data declaration`);
  }
  assert.ok(listing.includes(GECKO.id), 'store/firefox-listing.md should record the add-on id');
});

test('does not mutate the Chrome manifest', () => {
  const before = JSON.stringify(chrome);
  toFirefoxManifest(chrome);
  assert.equal(JSON.stringify(chrome), before);
});
