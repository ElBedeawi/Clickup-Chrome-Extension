// Guards against release drift: manifest ↔ files ↔ store listing ↔ zip packager.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordingFileName } from '../../lib/recorder.js';
import { screenshotFileName } from '../../lib/screenshot.js';
import { toFirefoxManifest } from '../../scripts/lib/firefox-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const firefoxManifest = toFirefoxManifest(manifest);

test('manifest is MV3 with a semver version', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});

test('every file the manifest references exists', () => {
  const files = [
    manifest.background.service_worker,
    manifest.side_panel.default_path,
    manifest.options_page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
  ];
  for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), `missing ${f}`);
});

test('every permission has a justification in the store listing', () => {
  const listing = read('store/listing.md');
  for (const p of manifest.permissions) assert.ok(listing.includes(`\`${p}\``), `store/listing.md doesn't justify ${p}`);
  for (const h of manifest.host_permissions) assert.ok(listing.includes(`\`${h}\``), `store/listing.md doesn't justify ${h}`);
});

test('the zip packager includes every top-level runtime path', () => {
  const pkg = read('scripts/package.mjs');
  const include = JSON.parse(pkg.match(/const INCLUDE = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  const topLevel = new Set(
    [
      manifest.background.service_worker,
      manifest.side_panel.default_path,
      manifest.options_page,
      ...Object.values(manifest.icons),
      ...firefoxManifest.background.scripts,
      firefoxManifest.sidebar_action.default_panel,
      firefoxManifest.options_ui.page,
      'offscreen/offscreen.html',
      'editor/editor.html',
      'viewer/viewer.html',
      'permissions/microphone.html',
      'lib/storage.js',
      'fonts/cookie-regular.woff2',
      'vendor/mediapipe/vision_bundle.mjs',
    ].map((f) => f.split('/')[0]),
  );
  for (const dir of topLevel) assert.ok(include.includes(dir), `package.mjs INCLUDE is missing ${dir}`);
});

test('the privacy policy is where both listings say it is', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'docs/privacy-policy.html')));
  const url = 'clickup-uploader.macawshub.com/privacy-policy.html';
  assert.ok(read('store/listing.md').includes(url));
  assert.ok(read('store/firefox-listing.md').includes(url));
});

test('the CSP allows wasm (background blur) but no eval, and connections only to ClickUp', () => {
  for (const m of [manifest, firefoxManifest]) {
    const csp = m.content_security_policy?.extension_pages ?? '';
    const directives = Object.fromEntries(
      csp
        .split(';')
        .map((d) => d.trim().split(/\s+/))
        .filter((d) => d[0])
        .map(([name, ...values]) => [name, values]),
    );
    assert.deepEqual(directives['script-src'], ["'self'", "'wasm-unsafe-eval'"]);
    assert.ok(!csp.includes("'unsafe-eval'"), 'no eval');
    // MediaPipe's bundle has built-in logging to Google: the browser itself must refuse it.
    assert.deepEqual(directives['connect-src'], ["'self'", 'data:', 'blob:', 'https://*.clickup.com']);
  }
});

test('the vendored MediaPipe files are present and unmodified', () => {
  const vendor = JSON.parse(read('vendor/mediapipe/VENDOR.json'));
  assert.equal(vendor.license, 'Apache-2.0');
  const paths = vendor.files.map((f) => f.path).sort();
  assert.deepEqual(paths, [
    'LICENSE',
    'models/selfie_segmenter.tflite',
    'vision_bundle.mjs',
    'wasm/vision_wasm_internal.js',
    'wasm/vision_wasm_internal.wasm',
  ]);
  for (const f of vendor.files) {
    const buf = fs.readFileSync(path.join(ROOT, 'vendor/mediapipe', f.path));
    assert.equal(buf.length, f.size, `${f.path}: size changed`);
    assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), f.sha256, `${f.path}: contents changed`);
  }
});

test('CHANGELOG mentions the manifest version', () => {
  assert.ok(read('CHANGELOG.md').includes(`[${manifest.version}]`), `add a ${manifest.version} section to CHANGELOG.md`);
});

test('attachment file names are sortable and filesystem-safe', () => {
  const date = new Date(2026, 0, 5, 7, 8, 9);
  assert.equal(recordingFileName(date), 'recording-2026-01-05-07-08.webm');
  assert.equal(screenshotFileName(date), 'screenshot-2026-01-05-07-08-09.png');
});
