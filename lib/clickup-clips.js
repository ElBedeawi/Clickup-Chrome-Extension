// "Upload as ClickUp Clip" — stores a recording as a real ClickUp Clip (Clips Hub entry, auto
// transcript), which the public API at api.clickup.com cannot do. It therefore uses ClickUp's
// private web-app API, reverse-engineered from the app on 2026-10-17. That is undocumented and may
// break on any ClickUp deploy; everything here fails soft and the normal task-attachment upload is
// unaffected. See ROADMAP.md and docs/privacy-policy.html.
//
// Flow:
//  1. mintTokenInPage(), inside an open app.clickup.com tab via chrome.scripting (clips-host.js): POST
//     https://id.app.clickup.com/data/v3/workspaces/<ws>/authentication/access_tokens (cookies, empty
//     body) → a workspace-scoped session token (its JWT payload carries workspace_id). It needs the
//     session cookies, which only travel from a *.clickup.com page: the same call from the extension
//     fails (checked 2026-10-19).
//  2. resolveShard(): the workspace's API host, from the public shard handshake.
//  3. uploadClip(), from the side panel itself: POST the file to <host>/v1/attachment with
//     `Authorization: Bearer <token>` + type=7 / parent=<workspace> / permanent=true / clip=true. No
//     cookies or other headers needed (checked 2026-10-19: 200, source 8, from the extension origin with
//     credentials 'omit'). Must be the Bearer, workspace-scoped token: a bare token → JWT_008, the plain
//     session token → JWT_015 (no workspace_id), the attachment_token → JWT_067.
//     Uploading from the panel means no size cap of our own (the file used to cross into the tab as a
//     data: URL, which capped it at ~45 MB) and real upload progress.

import { getPrefs, setPrefs } from './storage.js';

// The handshake is public and answered by api.clickup.com.
const HANDSHAKE_HOST = 'https://api.clickup.com';

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
export function clipsEligible(file) {
  if (!file?.type?.startsWith('video/')) return { ok: false, reason: 'Only videos can be saved to Clips.' };
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

/**
 * Uploads a file as a workspace Clip. Runs in the side panel (XHR, not fetch, for upload progress).
 * @param {{ base: string, token: string, workspaceId: string, file: File, onProgress?: (fraction:number)=>void }} opts
 * @returns {Promise<{ id:string, url:string, openUrl:string }>}
 */
export function uploadClip({ base, token, workspaceId, file, onProgress }) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('attachment', file, file.name);
    for (const [k, v] of Object.entries(clipFormFields(workspaceId))) form.append(k, v);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base}/v1/attachment`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const payload = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ id: payload?.id, url: payload?.url, openUrl: payload?.url_w_query || payload?.url });
      } else {
        // Kept (failure-only) so a future ClickUp change to this undocumented flow is easy to diagnose.
        console.warn('[clip] upload rejected', { status: xhr.status, code: payload?.ECODE, err: payload?.err });
        reject(clipError(xhr.status, payload));
      }
    };
    xhr.onerror = () => reject(new ClipError('Network error while saving the Clip.', { status: 0 }));
    xhr.onabort = () => reject(new ClipError('Clip upload cancelled.', { status: 0 }));
    xhr.send(form);
  });
}
