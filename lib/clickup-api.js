// Thin client for the ClickUp public API v2.
// Docs: https://developer.clickup.com/reference
import { getToken } from './storage.js';

const BASE = 'https://api.clickup.com/api/v2';

export class ClickUpError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ClickUpError';
    this.status = status;
    this.code = code;
  }
}

function buildUrl(path, query) {
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function toError(status, payload) {
  const apiMessage = payload?.err || payload?.error || '';
  const code = payload?.ECODE;
  if (status === 401) {
    return new ClickUpError(`Invalid or expired API token — check the extension options. ${apiMessage}`.trim(), status, code);
  }
  if (status === 429) return new ClickUpError('ClickUp rate limit reached — wait a minute and try again.', status, code);
  if (code === 'GBUSED_005') return new ClickUpError('Your ClickUp workspace is out of storage.', status, code);
  return new ClickUpError(apiMessage || `ClickUp request failed (HTTP ${status}).`, status, code);
}

async function authHeader() {
  const token = await getToken();
  if (!token) throw new ClickUpError('No ClickUp API token set — open the extension options.', 401);
  // Personal tokens (pk_...) go in the header as-is, without "Bearer".
  return { Authorization: token };
}

async function request(path, { method = 'GET', body, query } = {}) {
  const headers = await authHeader();
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ClickUpError('Network error — could not reach ClickUp.', 0);
  }

  const payload = await res.json().catch(() => null);
  if (!res.ok) throw toError(res.status, payload);
  return payload;
}

// ---- Account / hierarchy ----

export async function getUser() {
  const { user } = await request('/user');
  return user;
}

export async function getWorkspaces() {
  const { teams } = await request('/team');
  return teams;
}

export async function getSpaces(teamId) {
  const { spaces } = await request(`/team/${teamId}/space`, { query: { archived: false } });
  return spaces;
}

export async function getFolders(spaceId) {
  const { folders } = await request(`/space/${spaceId}/folder`, { query: { archived: false } });
  return folders;
}

export async function getFolderlessLists(spaceId) {
  const { lists } = await request(`/space/${spaceId}/list`, { query: { archived: false } });
  return lists;
}

export async function getLists(folderId) {
  const { lists } = await request(`/folder/${folderId}/list`, { query: { archived: false } });
  return lists;
}

/** Returns the list including its `statuses`. */
export function getList(listId) {
  return request(`/list/${listId}`);
}

// ---- Tasks ----

export function getTask(taskId, { customTaskIds = false, teamId } = {}) {
  const query = customTaskIds ? { custom_task_ids: true, team_id: teamId } : undefined;
  return request(`/task/${encodeURIComponent(taskId)}`, { query });
}

/**
 * @param {string} listId
 * @param {{ name: string, markdown_description?: string, status?: string, priority?: number }} task
 */
export function createTask(listId, task) {
  const body = { name: task.name };
  if (task.markdown_description) body.markdown_description = task.markdown_description;
  if (task.status) body.status = task.status;
  if (task.priority) body.priority = task.priority;
  return request(`/list/${listId}/task`, { method: 'POST', body });
}

/**
 * Uploads one file as a task attachment. Uses XHR (not fetch) so we get upload progress.
 * @param {string} taskId
 * @param {File} file
 * @param {(fraction: number) => void} [onProgress]
 * @param {{ customTaskIds?: boolean, teamId?: string }} [opts]
 */
export async function uploadAttachment(taskId, file, onProgress, { customTaskIds = false, teamId } = {}) {
  const headers = await authHeader();
  const query = customTaskIds ? { custom_task_ids: true, team_id: teamId } : undefined;
  const url = buildUrl(`/task/${encodeURIComponent(taskId)}/attachment`, query);

  const form = new FormData();
  form.append('attachment', file, file.name);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', headers.Authorization);
    xhr.responseType = 'json';

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else reject(toError(xhr.status, xhr.response));
    };
    xhr.onerror = () => reject(new ClickUpError('Network error while uploading.', 0));
    xhr.onabort = () => reject(new ClickUpError('Upload cancelled.', 0));

    xhr.send(form);
  });
}

// ---- Helpers ----

/**
 * Parses a task reference from a ClickUp URL or a bare ID.
 * Supports:
 *   https://app.clickup.com/t/86abc123
 *   https://app.clickup.com/t/9012345/DEV-123   (custom task ID, needs team_id)
 *   86abc123 / #86abc123 / DEV-123
 * @returns {{ taskId: string, customTaskIds: boolean, teamId?: string } | null}
 */
export function parseTaskRef(input) {
  const value = (input || '').trim();
  if (!value) return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }

  if (url) {
    if (!/(^|\.)clickup\.com$/.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const t = parts.indexOf('t');
    if (t === -1) return null;
    const rest = parts.slice(t + 1);
    if (rest.length >= 2 && /^\d+$/.test(rest[0])) {
      return { taskId: rest[1], customTaskIds: isCustomId(rest[1]), teamId: rest[0] };
    }
    if (rest.length >= 1) return { taskId: rest[0], customTaskIds: false };
    return null;
  }

  const id = value.replace(/^#/, '');
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return { taskId: id, customTaskIds: isCustomId(id) };
}

// Custom IDs look like PREFIX-123; native IDs are alphanumeric without a dash.
function isCustomId(id) {
  return /^[A-Za-z]+-\d+$/.test(id);
}
