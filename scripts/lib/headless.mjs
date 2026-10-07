// Shared headless-Chrome plumbing for scripts/render-assets.mjs and scripts/smoke-test.mjs.
// No dependencies: a tiny static server + the DevTools protocol over Node's built-in WebSocket.
//
// Pages are served from the repo root. When a URL has ?demo=<scene>, the server injects
// store/src/demo-shared.js + demo-stub.js into the page, which fake the chrome.* and ClickUp
// APIs so the real side panel / editor run against sample data.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Static server on a free port. @returns {Promise<{ origin: string, close(): void }>} */
export function startServer() {
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
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }),
    ),
  );
}

export function findChrome() {
  const candidates = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome not found — set CHROME=/path/to/chrome');
  return found;
}

/** Minimal DevTools-protocol client with flattened sessions. */
async function connect(wsUrl, onEvent) {
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
    } else if (msg.method) {
      onEvent(msg);
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

/**
 * Starts the server + headless Chrome, runs `fn({ origin, openPage })`, then cleans everything up.
 * `openPage({ url, width, height, transparent })` opens `url` (a path on the server) in a fresh,
 * isolated browser context and resolves once the page sets window.__ready (or times out).
 */
export async function withBrowser(fn) {
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'uploader-headless-'));
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--remote-debugging-port=0', // Chrome picks a free port and writes it to DevToolsActivePort
      `--user-data-dir=${profile}`,
      ...(process.env.CI ? ['--no-sandbox'] : []),
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const listeners = new Map(); // sessionId -> event handler
  let browser;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 80 && !fs.existsSync(portFile); i++) await sleep(250);
    if (!fs.existsSync(portFile)) throw new Error('Chrome did not start');
    const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
    browser = await connect(`ws://127.0.0.1:${port}${wsPath}`, (msg) => listeners.get(msg.sessionId)?.(msg));

    async function openPage({ url, width = 1280, height = 800, transparent = false, timeoutMs = 20_000 }) {
      const errors = [];
      const { browserContextId } = await browser.send('Target.createBrowserContext');
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
      listeners.set(sessionId, (msg) => {
        if (msg.method === 'Runtime.exceptionThrown') {
          const d = msg.params.exceptionDetails;
          errors.push(`uncaught: ${d.exception?.description || d.text}`);
        } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
          errors.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
        }
      });
      const send = (method, params) => browser.send(method, params, sessionId);
      await send('Runtime.enable');
      await send('Page.enable');
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      if (transparent) await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
      await send('Page.navigate', { url: server.origin + url });

      // Pages set window.__ready when they've finished drawing (demo pages need a few seconds).
      let ready = false;
      for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; ) {
        const { result } = await send('Runtime.evaluate', { expression: '!!window.__ready', returnByValue: true });
        if ((ready = result.value)) break;
        await sleep(150);
      }
      await sleep(300);

      return {
        ready,
        errors,
        send,
        evaluate: async (expression) =>
          (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value,
        screenshot: async () => Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
        close: async () => {
          listeners.delete(sessionId);
          await browser.send('Target.closeTarget', { targetId });
          await browser.send('Target.disposeBrowserContext', { browserContextId });
        },
      };
    }

    return await fn({ origin: server.origin, openPage });
  } finally {
    browser?.close();
    chrome.kill();
    server.close();
    await sleep(500);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
