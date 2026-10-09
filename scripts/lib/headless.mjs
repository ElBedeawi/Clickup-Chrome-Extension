// Shared headless-browser plumbing for scripts/render-assets.mjs and tests/smoke/.
// No dependencies: a tiny static server + a browser protocol over Node's built-in WebSocket.
//
//   Chrome (default)            — the DevTools protocol, flattened sessions
//   Firefox (SMOKE_BROWSER=firefox) — WebDriver BiDi; same openPage() contract, used by the smoke tests
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

function findBinary(name, envVar, candidates) {
  const found = [process.env[envVar], ...candidates].filter(Boolean).find((p) => fs.existsSync(p));
  if (!found) throw new Error(`${name} not found — set ${envVar}=/path/to/${name.toLowerCase()}`);
  return found;
}

export function findChrome() {
  return findBinary('Chrome', 'CHROME', [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]);
}

export function findFirefox() {
  return findBinary('Firefox', 'FIREFOX', [
    'C:/Program Files/Mozilla Firefox/firefox.exe',
    'C:/Program Files (x86)/Mozilla Firefox/firefox.exe',
    '/Applications/Firefox.app/Contents/MacOS/firefox',
    '/usr/bin/firefox',
    '/usr/bin/firefox-esr',
    '/opt/firefox/firefox',
    '/snap/bin/firefox', // snap confinement may block the temp profile; prefer a .deb/tarball build
  ]);
}

/**
 * Minimal JSON-RPC-over-WebSocket client that speaks both the DevTools protocol (flattened
 * sessions) and WebDriver BiDi: `{ id, method, params }` out, replies by id, everything else
 * is an event handed to `onEvent`.
 */
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
      pending.set(i, (msg) => {
        // CDP: { error: { message } }; BiDi: { type: 'error', error: '<code>', message }
        const failure = msg.type === 'error' ? `${msg.error}: ${msg.message}` : msg.error?.message;
        if (failure) reject(new Error(`${method}: ${failure}`));
        else resolve(msg.result);
      });
      ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    });
  return { send, close: () => ws.close() };
}

/** Waits for the file the browser writes once its debugging port is open. */
async function waitForFile(file, what) {
  for (let i = 0; i < 80 && !fs.existsSync(file); i++) await sleep(250);
  if (!fs.existsSync(file)) throw new Error(`${what} did not start`);
  return fs.readFileSync(file, 'utf8');
}

/** Pages set window.__ready when they've finished drawing (demo pages need a few seconds). */
async function waitForReady(evaluate, timeoutMs) {
  let ready = false;
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; ) {
    if ((ready = !!(await evaluate('!!window.__ready')))) break;
    await sleep(150);
  }
  await sleep(300);
  return ready;
}

/**
 * Starts the server + a headless browser, runs `fn({ origin, openPage })`, then cleans everything up.
 * `openPage({ url, width, height, transparent })` opens `url` (a path on the server) in a fresh,
 * isolated browser context and resolves once the page sets window.__ready (or times out) with
 * `{ ready, errors, evaluate, screenshot, close }`. `errors` collects uncaught exceptions and
 * console.error calls. `transparent` (a transparent page background) is Chrome-only.
 */
export function withBrowser(fn) {
  return process.env.SMOKE_BROWSER === 'firefox' ? withFirefox(fn) : withChrome(fn);
}

async function withChrome(fn) {
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
    const [port, wsPath] = (await waitForFile(path.join(profile, 'DevToolsActivePort'), 'Chrome')).trim().split('\n');
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

      const evaluate = async (expression) =>
        (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
      const ready = await waitForReady(evaluate, timeoutMs);

      return {
        ready,
        errors,
        send,
        evaluate,
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

async function withFirefox(fn) {
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'uploader-headless-ff-'));
  const firefox = spawn(
    findFirefox(),
    [
      '--headless',
      '--no-remote',
      '--new-instance',
      '--profile',
      profile,
      '--remote-debugging-port=0', // Firefox picks a free port and writes it to WebDriverBiDiServer.json
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const listeners = new Map(); // browsing context id -> event handler
  let browser;
  try {
    const { ws_host: host, ws_port: port } = JSON.parse(await waitForFile(path.join(profile, 'WebDriverBiDiServer.json'), 'Firefox'));
    browser = await connect(`ws://${host}:${port}/session`, (msg) => listeners.get(msg.params?.source?.context)?.(msg));
    await browser.send('session.new', { capabilities: {} });
    await browser.send('session.subscribe', { events: ['log.entryAdded'] });

    async function openPage({ url, width = 1280, height = 800, timeoutMs = 20_000 }) {
      const errors = [];
      const { userContext } = await browser.send('browser.createUserContext');
      const { context } = await browser.send('browsingContext.create', { type: 'tab', userContext });
      listeners.set(context, (msg) => {
        if (msg.method !== 'log.entryAdded' || msg.params.level !== 'error') return;
        errors.push(`${msg.params.type === 'javascript' ? 'uncaught' : 'console.error'}: ${msg.params.text}`);
      });
      const send = browser.send;
      await send('browsingContext.setViewport', { context, viewport: { width, height } });
      await send('browsingContext.navigate', { context, url: server.origin + url, wait: 'complete' });

      // Primitive results only (strings, numbers, booleans); the scenes JSON.stringify anything bigger.
      const evaluate = async (expression) => {
        const res = await send('script.evaluate', { expression, target: { context }, awaitPromise: true, resultOwnership: 'none' });
        if (res.type === 'exception') throw new Error(`evaluate: ${res.exceptionDetails?.text || 'failed'}`);
        return res.result?.value;
      };
      const ready = await waitForReady(evaluate, timeoutMs);

      return {
        ready,
        errors,
        send,
        evaluate,
        screenshot: async () => Buffer.from((await send('browsingContext.captureScreenshot', { context })).data, 'base64'),
        close: async () => {
          listeners.delete(context);
          await send('browsingContext.close', { context });
          await send('browser.removeUserContext', { userContext });
        },
      };
    }

    return await fn({ origin: server.origin, openPage });
  } finally {
    browser?.close();
    firefox.kill();
    server.close();
    await sleep(500);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
