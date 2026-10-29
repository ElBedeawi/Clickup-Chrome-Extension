// Shared plumbing for ClickUp's private web-app API, used by the two optional features the public API
// at api.clickup.com cannot do: "Save to Clips" (lib/clickup-clips.js) and the Brain chat
// (lib/clickup-brain.js). Undocumented and may break on any ClickUp deploy; callers fail soft.
//
//  1. mintTokenInPage(), inside an open app.clickup.com tab via chrome.scripting
//     (sidepanel/webapp-session.js): POST
//     https://id.app.clickup.com/data/v3/workspaces/<ws>/authentication/access_tokens (cookies, empty
//     body) → a workspace-scoped session token (its JWT payload carries workspace_id; it lasts about two
//     days). It needs the session cookies, which only travel from a *.clickup.com page: the same call
//     from the extension fails (checked 2026-10-19).
//  2. resolveShard(): the workspace's API host, from the public shard handshake.
//  3. Everything else runs from the panel itself with `Authorization: Bearer <token>`; no cookies or
//     other headers needed (checked 2026-10-19 for Clips, 2026-10-29 for Brain).

import { getPrefs, setPrefs } from './storage.js';

// The handshake is public and answered by api.clickup.com.
const HANDSHAKE_HOST = 'https://api.clickup.com';

/** The frontdoor base URL from a shard handshake response, or null if the shape is unexpected. */
export function parseHandshake(json) {
  const base = json?.appEnvironment?.apiUrlBase;
  return typeof base === 'string' && base.startsWith('https://') ? base : null;
}

// --- the function injected into an app.clickup.com tab ---------------------------------------
// Must be fully self-contained: chrome.scripting serializes it and runs it in the page, so it can
// close over nothing from this module. Mints a *workspace-scoped* session token for `workspaceId`
// (or, without one, the workspace the tab is viewing). ClickUp's own app uses this exact exchange,
// also when switching workspaces. Returns { ok, token, workspaceId, expiresAt } or { ok:false, ... }.
export async function mintTokenInPage(workspaceId) {
  try {
    // Workspace the signed-in session is viewing (app.clickup.com/<id>/...).
    const ws = workspaceId || (location.pathname.match(/\/(\d+)(?:\/|$)/) || [])[1] || null;
    if (!ws) return { ok: false, noWorkspace: true };
    const res = await fetch(
      `https://id.app.clickup.com/data/v3/workspaces/${ws}/authentication/access_tokens?trigger_source=extension`,
      { method: 'POST', credentials: 'include' }, // empty body; auth is the session cookies
    );
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON (e.g. an HTML login page when signed out) */
    }
    if (!res.ok) return { ok: false, status: res.status, err: data && (data.err || data.error), code: data && data.ECODE };
    const token = data && data.token;
    // `expiration` is in seconds.
    const expiresAt = data && Number(data.expiration) > 0 ? Number(data.expiration) * 1000 : null;
    return token ? { ok: true, token, workspaceId: String(ws), expiresAt } : { ok: false, status: res.status, noToken: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// --- prefs + extension-side networking --------------------------------------------------------

/**
 * Merges into `prefs.webapp` (= { shards }) without clobbering its other keys; setPrefs itself only
 * merges one level deep.
 */
export async function setWebappPrefs(patch) {
  const prefs = await getPrefs();
  await setPrefs({ webapp: { ...prefs.webapp, ...patch } });
}

/** Frontdoor base URL for a workspace, cached in prefs until clearShard() drops it. */
export async function resolveShard(workspaceId, { fetchImpl = fetch } = {}) {
  const prefs = await getPrefs();
  const cached = prefs.webapp?.shards?.[workspaceId];
  if (cached?.base) return cached.base;

  const res = await fetchImpl(`${HANDSHAKE_HOST}/shard/v1/handshake/${workspaceId}`);
  const json = await res.json().catch(() => null);
  const base = parseHandshake(json);
  if (!base) {
    const err = new Error('Could not find the ClickUp API host for this workspace.');
    err.status = res.status;
    throw err;
  }

  await setWebappPrefs({ shards: { ...prefs.webapp?.shards, [workspaceId]: { base, at: Date.now() } } });
  return base;
}

/** Drops the cached shard for a workspace (call after an auth/not-found failure). */
export async function clearShard(workspaceId) {
  const prefs = await getPrefs();
  if (!prefs.webapp?.shards?.[workspaceId]) return;
  const shards = { ...prefs.webapp.shards };
  delete shards[workspaceId];
  await setWebappPrefs({ shards });
}
