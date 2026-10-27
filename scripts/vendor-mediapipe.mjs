// Fetches the pinned MediaPipe files the camera-bubble background blur runs on into
// vendor/mediapipe/, byte for byte, and records their sizes and sha256 in VENDOR.json.
// The extension never downloads anything at runtime: these files ship inside it.
// No dependencies.
//
//   node scripts/vendor-mediapipe.mjs           download (or re-download) and write VENDOR.json
//   node scripts/vendor-mediapipe.mjs --check   verify the files on disk against VENDOR.json
//
// To update: bump VERSION (and MODEL_VERSION if needed), run without --check, then test.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'vendor', 'mediapipe');
const MANIFEST = path.join(DIR, 'VENDOR.json');

const VERSION = '1.1.1';
const MODEL_VERSION = '1';
const NPM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;

const FILES = [
  { path: 'vision_bundle.mjs', url: `${NPM}/vision_bundle.mjs` },
  { path: 'wasm/vision_wasm_internal.js', url: `${NPM}/wasm/vision_wasm_internal.js` },
  { path: 'wasm/vision_wasm_internal.wasm', url: `${NPM}/wasm/vision_wasm_internal.wasm` },
  {
    path: 'models/selfie_segmenter.tflite',
    url: `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/${MODEL_VERSION}/selfie_segmenter.tflite`,
  },
  { path: 'LICENSE', url: 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE' },
];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

if (process.argv.includes('--check')) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  let bad = 0;
  for (const f of manifest.files) {
    const file = path.join(DIR, f.path);
    const buf = fs.existsSync(file) ? fs.readFileSync(file) : null;
    const ok = buf && buf.length === f.size && sha256(buf) === f.sha256;
    console.log(`${ok ? '✓' : '✗'} ${f.path}`);
    if (!ok) bad++;
  }
  if (bad) {
    console.error(`${bad} file(s) missing or changed. Run node scripts/vendor-mediapipe.mjs to restore them.`);
    process.exit(1);
  }
} else {
  const files = [];
  for (const f of FILES) {
    const res = await fetch(f.url);
    if (!res.ok) throw new Error(`${f.url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const out = path.join(DIR, f.path);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    files.push({ path: f.path, url: f.url, size: buf.length, sha256: sha256(buf) });
    console.log(`✓ ${f.path}  ${(buf.length / 1024).toFixed(0)} KB`);
  }
  const manifest = {
    package: '@mediapipe/tasks-vision',
    version: VERSION,
    model: `selfie_segmenter float16 v${MODEL_VERSION}`,
    license: 'Apache-2.0',
    source: 'https://github.com/google-ai-edge/mediapipe',
    note: 'Unmodified upstream files. Used only for the camera bubble background blur (lib/background-blur.js).',
    files,
  };
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, MANIFEST)}`);
}
