// Side-panel glue for "Save to Clips". Minting the workspace token needs the user's ClickUp session
// cookies, which only travel from a *.clickup.com page, so we find (or open) an app.clickup.com tab and
// run mintTokenInPage in it via chrome.scripting (world:'MAIN'). Everything else (the shard handshake
// and the upload itself) happens here in the panel. See lib/clickup-clips.js.

import { mintTokenInPage, uploadClip, resolveShard, ClipError } from '../lib/clickup-clips.js';

const APP_MATCH = 'https://app.clickup.com/*';

/** An existing app.clickup.com tab id (prefers the active one), or null. */
async function findClickUpTab() {
  const tabs = await chrome.tabs.query({ url: APP_MATCH });
  if (!tabs.length) return null;
  return (tabs.find((t) => t.active) || tabs[0]).id;
}

const WORKSPACE_URL = /^https:\/\/app\.clickup\.com\/\d+(\/|$)/;

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

/**
 * Mints the workspace token, retrying while the page is still settling on a workspace URL (a freshly
 * opened tab redirects through a few states). Stops early on success or a definite server answer.
 */
async function mintWithRetry(tabId, attempts = 8) {
  let last;
  for (let i = 0; i < attempts; i++) {
    last = await runInTab(tabId, mintTokenInPage).catch((err) => ({ ok: false, error: err.message }));
    if (last?.ok) return last;
    // A concrete HTTP status (e.g. 401 signed-out) is final; keep retrying only while the tab isn't ready.
    if (last && typeof last.status === 'number') return last;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return last;
}

async function runInTab(tabId, func, args) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
  return res?.result;
}

/**
 * Uploads a file as a workspace Clip (token minted in an app.clickup.com tab, upload from here).
 * @param {File} file
 * @param {(fraction:number|null)=>void} [onProgress]  null while the token is minted, then 0–1
 * @returns {Promise<{ id:string, url:string, openUrl:string, workspaceId:string }>}
 */
export async function uploadAsClip(file, onProgress) {
  onProgress?.(null);
  let workspaceId;
  let token;
  let tabId = await findClickUpTab();
  let opened = false;
  if (!tabId) {
    tabId = await openClickUpTab();
    opened = true;
  }

  try {
    // 1. Mint a workspace-scoped token and learn which workspace the tab is signed into.
    const minted = await mintWithRetry(tabId);
    if (!minted?.ok) {
      console.warn('[clip] token mint failed', minted);
      if (minted?.status === 401 || minted?.noToken) {
        throw new ClipError('Sign in to ClickUp in this browser, then try again.', { status: 401 });
      }
      if (minted?.noWorkspace) {
        throw new ClipError('Your ClickUp tab is still loading a workspace. Open ClickUp, then try again.', { status: 0 });
      }
      throw new ClipError('Could not get a ClickUp session. Make sure you are signed in to ClickUp.', { status: minted?.status || 0 });
    }
    workspaceId = minted.workspaceId;
    token = minted.token;
  } finally {
    // The tab is only needed for the token; close one we opened before the (possibly long) upload.
    if (opened) chrome.tabs.remove(tabId).catch(() => {});
  }

  // 2. Resolve the workspace's API host (public handshake) and upload straight from the panel.
  const base = await resolveShard(workspaceId);
  onProgress?.(0);
  const result = await uploadClip({ base, token, workspaceId, file, onProgress });
  return { ...result, workspaceId };
}
