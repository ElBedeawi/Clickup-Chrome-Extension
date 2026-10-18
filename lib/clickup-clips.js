// "Upload as ClickUp Clip" — stores a recording as a real ClickUp Clip (Clips Hub entry, auto
// transcript), which the public API at api.clickup.com cannot do. It therefore uses ClickUp's
// private web-app API, reverse-engineered from the app on 2026-10-17. That is undocumented and may
// break on any ClickUp deploy; everything here fails soft and the normal task-attachment upload is
// unaffected. See ROADMAP.md and docs/privacy-policy.html.
//
// Flow (both page steps need the session cookies, which only travel from a *.clickup.com page, so the
// side panel runs them inside an open app.clickup.com tab via chrome.scripting — see clips-host.js):
//  1. mintTokenInPage(): POST https://id.app.clickup.com/data/v3/workspaces/<ws>/authentication/
//     access_tokens (cookies, empty body) → a workspace-scoped session token (its JWT payload carries
//     workspace_id). This is the token ClickUp's own app uses for the upload.
//  2. uploadInPage(): read the workspace's API host from the public shard handshake, then POST the file
//     to <host>/v1/attachment with `Authorization: Bearer <token>` + type=7 / parent=<workspace> /
//     permanent=true / clip=true. Must be the Bearer, workspace-scoped token: a bare token → JWT_008,
//     the plain session token → JWT_015 (no workspace_id), the attachment_token → JWT_067.

import { getPrefs, setPrefs } from './storage.js';

// The handshake is public and answered by api.clickup.com.
const HANDSHAKE_HOST = 'https://api.clickup.com';

// chrome.scripting args are serialized and the file rides into the ClickUp tab as a data: URL,
// so cap the size we try (clips-host.js).
export const MAX_CLIP_BYTES = 45 * 1024 * 1024;

export class ClipError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.name = 'ClipError';
    this.code = code;
    this.status = status;
  }
}

// --- pure helpers (unit-tested; no chrome/DOM) -----------------------------------------------

/** Multipart field set that marks an attachment as a workspace Clip. */
export function clipFormFields(workspaceId) {
  return { type: '7', parent: String(workspaceId), permanent: 'true', clip: 'true' };
}

/** The frontdoor base URL from a shard handshake response, or null if the shape is unexpected. */
export function parseHandshake(json) {
  const base = json?.appEnvironment?.apiUrlBase;
  return typeof base === 'string' && base.startsWith('https://') ? base : null;
}

/** Clips Hub URL for a workspace. */
export function clipsHubUrl(workspaceId) {
  return `https://app.clickup.com/${workspaceId}/hubs/clips`;
}

/**
 * Whether a pending attachment can be saved as a Clip (the Clips tab is video-only).
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function clipsEligible(file, { maxBytes = MAX_CLIP_BYTES } = {}) {
  if (!file?.type?.startsWith('video/')) return { ok: false, reason: 'Only videos can be saved to Clips.' };
  if (file.size > maxBytes) return { ok: false, reason: `Too large for a Clip (over ${Math.round(maxBytes / 1024 ** 2)} MB).` };
  return { ok: true };
}

/** Turns a failed Clip step into a message a user can act on. */
export function clipError(status, payload) {
  const code = payload?.ECODE;
  const msg = payload?.err || payload?.error || '';
  if (code === 'GBUSED_005') return new ClipError('Your ClickUp workspace is out of storage.', { code, status });
  if (status === 401 || /JWT_/.test(code || '')) {
    return new ClipError('Sign in to ClickUp in this browser, then try again.', { code, status });
  }
  if (status === 403) return new ClipError("This workspace doesn't allow Clips.", { code, status });
  return new ClipError(msg || `Clip upload failed (HTTP ${status}).`, { code, status });
}

// --- the function injected into an app.clickup.com tab ---------------------------------------
// Must be fully self-contained: chrome.scripting serializes it and runs it in the page, so it can
// close over nothing from this module. Mints a *workspace-scoped* session token — the only token the
// clip upload accepts (its JWT payload carries workspace_id; the plain refresh_token one does not).
// ClickUp's own app uses this exact exchange; it needs the session cookies, which only travel from a
// *.clickup.com page, hence running here. Returns { ok, token, workspaceId } or { ok:false, ... }.
export async function mintTokenInPage() {
  try {
    // Workspace the signed-in session is viewing (app.clickup.com/<id>/...).
    const workspaceId = (location.pathname.match(/\/(\d+)(?:\/|$)/) || [])[1] || null;
    if (!workspaceId) return { ok: false, noWorkspace: true };
    const res = await fetch(
      `https://id.app.clickup.com/data/v3/workspaces/${workspaceId}/authentication/access_tokens?trigger_source=extension`,
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
    return token ? { ok: true, token, workspaceId } : { ok: false, status: res.status, noToken: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// --- prefs + extension-side networking --------------------------------------------------------

/**
 * Merges into `prefs.clips` (= { autoSave, shards }) without clobbering its other keys; setPrefs
 * itself only merges one level deep.
 */
export async function setClipsPrefs(patch) {
  const prefs = await getPrefs();
  await setPrefs({ clips: { ...prefs.clips, ...patch } });
}

/** Frontdoor base URL for a workspace, cached in prefs until a 401/404 clears it. */
export async function resolveShard(workspaceId, { fetchImpl = fetch } = {}) {
  const prefs = await getPrefs();
  const cached = prefs.clips?.shards?.[workspaceId];
  if (cached?.base) return cached.base;

  const res = await fetchImpl(`${HANDSHAKE_HOST}/shard/v1/handshake/${workspaceId}`);
  const json = await res.json().catch(() => null);
  const base = parseHandshake(json);
  if (!base) throw new ClipError('Could not find the ClickUp API host for this workspace.', { status: res.status });

  await setClipsPrefs({ shards: { ...prefs.clips?.shards, [workspaceId]: { base, at: Date.now() } } });
  return base;
}

/** Drops the cached shard for a workspace (call after an auth/not-found failure). */
export async function clearShard(workspaceId) {
  const prefs = await getPrefs();
  if (!prefs.clips?.shards?.[workspaceId]) return;
  const shards = { ...prefs.clips.shards };
  delete shards[workspaceId];
  await setClipsPrefs({ shards });
}

// The upload must run inside a *.clickup.com page: the frontdoor only accepts the Authorization
// header from the app.clickup.com origin (a cross-origin request from the extension reaches it
// stripped — JWT_008), whereas the page is same-site and ClickUp's CORS allows it. So the side panel
// resolves the shard and mints the token, then injects this self-contained function into the open
// ClickUp tab (chrome.scripting, world:'MAIN') to do the actual POST and hand the result back.
//
// The file crosses into the page as a data: URL string (chrome.scripting args are JSON only), which
// the page turns back into a File. Returns a plain, serializable result object.
export async function uploadInPage({ base, token, workspaceId, dataUrl, name, mime }) {
  try {
    // Decode the data: URL by hand — fetch('data:…') can trip the page's CSP connect-src.
    const comma = dataUrl.indexOf(',');
    const header = dataUrl.slice(0, comma);
    const bin = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const type = (header.match(/^data:([^;]+)/) || [])[1] || mime || 'application/octet-stream';
    const file = new File([bytes], name, { type });
    const form = new FormData();
    form.append('attachment', file, name);
    form.append('type', '7');
    form.append('parent', String(workspaceId));
    form.append('permanent', 'true');
    form.append('clip', 'true');
    const res = await fetch(`${base}/v1/attachment`, {
      method: 'POST',
      credentials: 'include', // the app sends the session cookies alongside the Bearer token
      headers: { Authorization: `Bearer ${token}`, 'X-Workspace-ID': String(workspaceId), 'X-CSRF': '1' },
      body: form,
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, payload };
    return { ok: true, id: payload && payload.id, url: payload && payload.url, openUrl: payload && (payload.url_w_query || payload.url) };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}
