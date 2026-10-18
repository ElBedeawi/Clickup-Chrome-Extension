// Side-panel glue for "Upload as ClickUp Clip". Both steps that touch ClickUp's web-app API must run
// inside a *.clickup.com page, where the browser is first-party: the session cookies travel (to mint
// a token) and the frontdoor accepts the Authorization header (a cross-origin request from the
// extension reaches it stripped). So we find (or open) an app.clickup.com tab and run two
// self-contained functions in it via chrome.scripting (world:'MAIN'): mintTokenInPage, then
// uploadInPage. The extension only resolves the shard host (a public handshake) and moves the file
// in as a data: URL. See lib/clickup-clips.js.

import { mintTokenInPage, uploadInPage, resolveShard, clipError, ClipError, MAX_CLIP_BYTES } from '../lib/clickup-clips.js';

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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new ClipError('Could not read the recording.', { status: 0 }));
    reader.readAsDataURL(file);
  });
}

async function runInTab(tabId, func, args) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
  return res?.result;
}

/**
 * Uploads a file as a workspace Clip through an app.clickup.com tab.
 * @param {File} file
 * @param {(fraction:number|null)=>void} [onProgress]  called with null (indeterminate; no progress event)
 * @returns {Promise<{ id:string, url:string, openUrl:string, workspaceId:string }>}
 */
export async function uploadAsClip(file, onProgress) {
  if (file.size > MAX_CLIP_BYTES) {
    throw new ClipError(`This recording is too large to save as a Clip (over ${Math.round(MAX_CLIP_BYTES / 1024 ** 2)} MB). Attach it to a task instead.`, { status: 0 });
  }

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
    const workspaceId = minted.workspaceId;

    // 2. Resolve the workspace's API host (public handshake, from the extension) and upload in-page.
    const base = await resolveShard(workspaceId);
    onProgress?.(null);
    const dataUrl = await fileToDataUrl(file);
    const result = await runInTab(tabId, uploadInPage, [{ base, token: minted.token, workspaceId, dataUrl, name: file.name, mime: file.type }]);

    if (!result?.ok) {
      // Kept (failure-only) so a future ClickUp change to this undocumented flow is easy to diagnose.
      console.warn('[clip] upload rejected', { status: result?.status, code: result?.payload?.ECODE, err: result?.payload?.err, jsError: result?.error });
      throw clipError(result?.status || 0, result?.payload);
    }
    return { id: result.id, url: result.url, openUrl: result.openUrl, workspaceId };
  } finally {
    if (opened) chrome.tabs.remove(tabId).catch(() => {});
  }
}
