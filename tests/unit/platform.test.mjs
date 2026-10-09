import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { hasOffscreen, isSidebar, canRecordTab, browserName, siteAccessHint, keepPanelOpenHint } from '../../lib/platform.js';

afterEach(() => {
  delete globalThis.chrome;
});

test('Chrome: side panel + offscreen document', () => {
  globalThis.chrome = { sidePanel: {}, offscreen: {} };
  assert.equal(hasOffscreen(), true);
  assert.equal(isSidebar(), false);
  assert.equal(canRecordTab(), true);
  assert.equal(browserName(), 'Chrome');
  assert.match(siteAccessHint(), /chrome:\/\/extensions/);
  assert.equal(keepPanelOpenHint(), '');
});

test('Firefox: sidebar, no offscreen documents, no tab sharing', () => {
  globalThis.chrome = { sidebarAction: {} };
  assert.equal(hasOffscreen(), false);
  assert.equal(isSidebar(), true);
  assert.equal(canRecordTab(), false);
  assert.equal(browserName(), 'Firefox');
  assert.match(siteAccessHint(), /about:addons/);
  assert.match(keepPanelOpenHint(), /sidebar open/);
});

test('Opera exposes both namespaces and behaves like Chrome', () => {
  globalThis.chrome = { sidePanel: {}, sidebarAction: {}, offscreen: {} };
  assert.equal(isSidebar(), false);
  assert.equal(canRecordTab(), true);
});

test('without any chrome object (plain pages, tests) the Chrome wording is used', () => {
  assert.equal(isSidebar(), false);
  assert.equal(hasOffscreen(), false);
  assert.equal(browserName(), 'Chrome');
});
