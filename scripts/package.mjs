// Builds the store uploads with only the files the extension needs at runtime (no store/,
// scripts/, README…). No dependencies.
//
//   dist/<name>-<version>.zip           Chrome Web Store (manifest.json as-is)
//   dist/<name>-<version>-firefox.zip   addons.mozilla.org (manifest derived by lib/firefox-manifest.mjs)
//   dist/firefox/                       the same, unpacked, for about:debugging → Load Temporary Add-on
//
//   node scripts/package.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { toFirefoxManifest } from './lib/firefox-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INCLUDE = ['manifest.json', 'background.js', 'icons', 'sidepanel', 'options', 'offscreen', 'editor', 'permissions', 'lib', 'fonts'];

function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`Missing ${rel}`);
  if (fs.statSync(abs).isFile()) return [rel];
  return fs
    .readdirSync(abs)
    .sort()
    .flatMap((name) => walk(path.posix.join(rel, name)));
}

// CRC-32 (zlib.crc32 needs Node 22.2+; fall back to a table otherwise).
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 =
  zlib.crc32 ??
  ((buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  });

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** @param {{ rel: string, data: Buffer }[]} entries */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());

  for (const { rel, data } of entries) {
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length; // don't grow already-compressed files (PNG)
    const body = stored ? data : deflated;
    const name = Buffer.from(rel, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

let failed = false;

function writeZip(out, entries) {
  try {
    fs.writeFileSync(out, zip(entries));
  } catch (err) {
    // Typically the old zip is open in Explorer or a browser's "install from file" dialog.
    // Keep going so the other outputs are still refreshed, but fail at the end.
    console.error(`Could not write ${path.relative(ROOT, out)}: ${err.message}. Close whatever has it open and run again.`);
    failed = true;
    return;
  }
  console.log(`${path.relative(ROOT, out)}  (${entries.length} files, ${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const slug = manifest.name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dist = path.join(ROOT, 'dist');
fs.mkdirSync(dist, { recursive: true });

// Chrome: the repo as-is.
const chromeEntries = INCLUDE.flatMap(walk).map((rel) => ({ rel, data: fs.readFileSync(path.join(ROOT, rel)) }));
writeZip(path.join(dist, `${slug}-${manifest.version}.zip`), chromeEntries);

// Firefox: the same files with the derived manifest, unpacked (for about:debugging) and zipped.
const firefoxManifest = Buffer.from(`${JSON.stringify(toFirefoxManifest(manifest), null, 2)}\n`);
const firefoxEntries = chromeEntries.map((e) => (e.rel === 'manifest.json' ? { rel: e.rel, data: firefoxManifest } : e));

const unpacked = path.join(dist, 'firefox');
fs.rmSync(unpacked, { recursive: true, force: true });
for (const { rel, data } of firefoxEntries) {
  const abs = path.join(unpacked, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
}
console.log(`${path.relative(ROOT, unpacked)}/  (unpacked, for about:debugging)`);

writeZip(path.join(dist, `${slug}-${manifest.version}-firefox.zip`), firefoxEntries);

if (failed) process.exit(1);
