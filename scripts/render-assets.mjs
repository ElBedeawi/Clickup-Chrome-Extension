// Renders the extension icons and Chrome Web Store images from store/src/ with headless Chrome.
//
//   node scripts/render-assets.mjs            # everything
//   node scripts/render-assets.mjs icons      # only jobs whose output path contains "icons"
//
// Set CHROME to a Chrome/Edge executable if it isn't found automatically.
// Demo pages run the real side panel / editor against sample data: the server injects
// store/src/demo-stub.js into those pages when the URL has ?demo=…
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8790;
const DEBUG_PORT = 9340;

const JOBS = [
  // Toolbar / extension-page icons: full bleed. Store icon: 96px artwork + 16px padding.
  { url: '/store/src/icon.html?size=16', w: 16, h: 16, out: 'icons/icon-16.png', transparent: true },
  { url: '/store/src/icon.html?size=32', w: 32, h: 32, out: 'icons/icon-32.png', transparent: true },
  { url: '/store/src/icon.html?size=48', w: 48, h: 48, out: 'icons/icon-48.png', transparent: true },
  { url: '/store/src/icon.html?size=128&pad=8', w: 128, h: 128, out: 'icons/icon-128.png', transparent: true },
  { url: '/store/src/icon.html?size=128&pad=16', w: 128, h: 128, out: 'store/images/store-icon-128.png', transparent: true },
  // Store listing images
  { url: '/store/src/screenshot.html?scene=new', w: 1280, h: 800, out: 'store/images/screenshot-1-record.png' },
  { url: '/store/src/editor-demo.html', w: 1280, h: 800, out: 'store/images/screenshot-2-annotate.png' },
  { url: '/store/src/screenshot.html?scene=details', w: 1280, h: 800, out: 'store/images/screenshot-3-details.png' },
  { url: '/store/src/screenshot.html?scene=existing', w: 1280, h: 800, out: 'store/images/screenshot-4-existing.png' },
  { url: '/store/src/promo.html?size=small', w: 440, h: 280, out: 'store/images/promo-small-440x280.png' },
  { url: '/store/src/promo.html?size=marquee', w: 1400, h: 560, out: 'store/images/promo-marquee-1400x560.png' },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    let body = fs.readFileSync(file);
    if (url.searchParams.has('demo') && file.endsWith('.html')) {
      body = body
        .toString()
        .replace(
          '<script type="module"',
          '<script src="/store/src/demo-shared.js"></script>\n  <script src="/store/src/demo-stub.js"></script>\n  <script type="module"',
        );
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

function findChrome() {
  const candidates = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome not found — set CHROME=/path/to/chrome');
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      console.warn('  page error:', msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    });
  return { send, close: () => ws.close() };
}

async function render(browser, job) {
  // Fresh context per job, so IndexedDB/storage from one demo can't leak into the next.
  const { browserContextId } = await browser.send('Target.createBrowserContext');
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => browser.send(method, params, sessionId);
  await s('Runtime.enable');
  await s('Page.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: job.w, height: job.h, deviceScaleFactor: 1, mobile: false });
  if (job.transparent) await s('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await s('Page.navigate', { url: `http://localhost:${PORT}${job.url}` });

  // Pages set window.__ready when they've finished drawing (demo pages need a few seconds).
  const deadline = Date.now() + 20_000;
  for (;;) {
    const { result } = await s('Runtime.evaluate', { expression: '!!window.__ready', returnByValue: true });
    if (result.value) break;
    if (Date.now() > deadline) {
      console.warn(`  ${job.out}: timed out waiting for __ready, capturing anyway`);
      break;
    }
    await sleep(150);
  }
  await sleep(300);
  const { data } = await s('Page.captureScreenshot', { format: 'png' });
  const out = path.join(ROOT, job.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
  await browser.send('Target.closeTarget', { targetId });
  await browser.send('Target.disposeBrowserContext', { browserContextId });
  console.log(`✓ ${job.out}`);
}

const filter = process.argv[2];
const jobs = JOBS.filter((j) => !filter || j.out.includes(filter));
const server = await serve();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'uploader-assets-'));
const chrome = spawn(
  findChrome(),
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: 'ignore' },
);

try {
  let version;
  for (let i = 0; i < 60 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error('Chrome did not start');
  const browser = await cdp(version.webSocketDebuggerUrl);
  for (const job of jobs) await render(browser, job);
  browser.close();
} finally {
  chrome.kill();
  server.close();
  await sleep(500);
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
