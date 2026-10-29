// Side-panel glue for ClickUp's private web-app API (used by Save to Clips and the Brain chat).
// Minting the workspace token needs the user's ClickUp session cookies, which only travel from a
// *.clickup.com page, so we find (or open) an app.clickup.com tab and run mintTokenInPage in it via
// chrome.scripting (world:'MAIN'). Everything else happens in the panel. See lib/clickup-webapp.js.

import { mintTokenInPage, resolveShard } from '../lib/clickup-webapp.js';

const APP_MATCH = 'https://app.clickup.com/*';
const WORKSPACE_URL = /^https:\/\/app\.clickup\.com\/\d+(\/|$)/;
/** Re-mint this long before the token's own expiry. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
/** Without an expiry from ClickUp, keep a token this long. */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

export class SessionError extends Error {
  constructor(message, { status = 0 } = {}) {
    super(message);
    this.name = 'SessionError';
    this.status = status;
  }
}

/** An existing app.clickup.com tab id (prefers the active one), or null. */
async function findClickUpTab() {
  const tabs = await chrome.tabs.query({ url: APP_MATCH });
  if (!tabs.length) return null;
  return (tabs.find((t) => t.active) || tabs[0]).id;
}

/** Resolves once the tab's URL is a workspace URL (app.clickup.com/<id>/…), or after `timeoutMs`. */
async function waitForWorkspaceUrl(tabId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (WORKSPACE_URL.test(tab.url || '')) return true;
    } catch {
      return false; // tab gone
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Opens app.clickup.com in a background tab and resolves its id once it reaches a workspace URL. */
async function openClickUpTab() {
  const tab = await chrome.tabs.create({ url: 'https://app.clickup.com/', active: false });
  await waitForWorkspaceUrl(tab.id);
  return tab.id;
}

async function runInTab(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
  return res?.result;
}

/**
 * Mints the workspace token, retrying while the page is still settling on a workspace URL (a freshly
 * opened tab redirects through a few states). Stops early on success or a definite server answer.
 */
async function mintWithRetry(tabId, workspaceId, attempts = 8) {
  let last;
  for (let i = 0; i < attempts; i++) {
    last = await runInTab(tabId, mintTokenInPage, workspaceId ? [workspaceId] : []).catch((err) => ({ ok: false, error: err.message }));
    if (last?.ok) return last;
    // A concrete HTTP status (e.g. 401 signed-out) is final; keep retrying only while the tab isn't ready.
    if (last && typeof last.status === 'number') return last;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return last;
}

/** Mints a token in a ClickUp tab (opening one in the background if needed, and closing it after). */
async function mint(workspaceId) {
  let tabId = await findClickUpTab();
  let opened = false;
  if (!tabId) {
    tabId = await openClickUpTab();
    opened = true;
  }
  try {
    const minted = await mintWithRetry(tabId, workspaceId);
    if (minted?.ok) return minted;
    console.warn('[webapp] token mint failed', minted);
    if (minted?.status === 401 || minted?.noToken) {
      throw new SessionError('Sign in to ClickUp in this browser, then try again.', { status: 401 });
    }
    if (minted?.status === 403 || minted?.status === 404) {
      throw new SessionError("Your ClickUp sign-in in this browser doesn't include this workspace.", { status: minted.status });
    }
    if (minted?.noWorkspace) {
      throw new SessionError('Your ClickUp tab is still loading a workspace. Open ClickUp, then try again.');
    }
    throw new SessionError('Could not get a ClickUp session. Make sure you are signed in to ClickUp.', { status: minted?.status || 0 });
  } finally {
    // The tab is only needed for the token.
    if (opened) chrome.tabs.remove(tabId).catch(() => {});
  }
}

/** Tokens minted for an explicit workspace, kept in memory only (never stored). */
const sessions = new Map();
const pending = new Map();

/**
 * A workspace-scoped session for ClickUp's web-app API.
 * With `workspaceId`, the token is minted for that workspace and reused until shortly before it
 * expires; without one (Save to Clips), it is minted fresh for the workspace the ClickUp tab is viewing.
 * @param {{ workspaceId?: string }} [opts]
 * @returns {Promise<{ token: string, workspaceId: string, base: string }>}
 */
export async function getSession({ workspaceId } = {}) {
  if (!workspaceId) {
    const minted = await mint();
    const base = await resolveShard(minted.workspaceId);
    return { token: minted.token, workspaceId: minted.workspaceId, base };
  }
  const key = String(workspaceId);
  const cached = sessions.get(key);
  if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return cached.session;
  if (!pending.has(key)) {
    const p = (async () => {
      const minted = await mint(key);
      const base = await resolveShard(key);
      const session = { token: minted.token, workspaceId: key, base };
      sessions.set(key, { session, expiresAt: minted.expiresAt || Date.now() + DEFAULT_TTL_MS });
      return session;
    })().finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return pending.get(key);
}

/** Forgets a workspace's token (after a 401), so the next getSession() mints a new one. */
export function dropSession(workspaceId) {
  sessions.delete(String(workspaceId));
}
