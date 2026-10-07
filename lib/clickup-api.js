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

// ---- Rate limiting ----
// ClickUp allows ~100 requests/minute per token and answers 429 beyond that, with
// X-RateLimit-Reset (unix seconds) saying when the window resets. Retry a few times.

const MAX_RETRIES = 3;
const MAX_WAIT_MS = 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {(name: string) => string | null} header */
export function retryDelayMs(header, attempt) {
  const retryAfter = Number(header('Retry-After'));
  if (retryAfter > 0) return Math.min(retryAfter * 1000, MAX_WAIT_MS);
  const reset = Number(header('X-RateLimit-Reset'));
  if (reset > 0) return Math.min(Math.max(reset * 1000 - Date.now(), 0) + 500, MAX_WAIT_MS);
  return Math.min(2 ** attempt * 1000, MAX_WAIT_MS); // 1s, 2s, 4s
}

async function request(path, { method = 'GET', body, query } = {}) {
  const headers = await authHeader();
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  for (let attempt = 0; ; attempt++) {
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

    if (res.status === 429 && attempt < MAX_RETRIES) {
      await sleep(retryDelayMs((name) => res.headers.get(name), attempt));
      continue;
    }

    const payload = await res.json().catch(() => null);
    if (!res.ok) throw toError(res.status, payload);
    return payload;
  }
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

/** People who can be assigned to tasks in the list. */
export async function getListMembers(listId) {
  const { members } = await request(`/list/${listId}/member`);
  return members;
}

/** Custom fields available on tasks in the list. */
export async function getListFields(listId) {
  const { fields } = await request(`/list/${listId}/field`);
  return fields;
}

export async function getSpaceTags(spaceId) {
  const { tags } = await request(`/space/${spaceId}/tag`);
  return tags;
}

// ---- Tasks ----

function taskQuery({ customTaskIds = false, teamId } = {}) {
  return customTaskIds ? { custom_task_ids: true, team_id: teamId } : undefined;
}

export function getTask(taskId, ref) {
  return request(`/task/${encodeURIComponent(taskId)}`, { query: taskQuery(ref) });
}

/**
 * @param {string} listId
 * @param {{
 *   name: string,
 *   markdown_description?: string,
 *   status?: string,
 *   priority?: number,
 *   assignees?: number[],
 *   tags?: string[],
 *   due_date?: number,          // unix ms
 *   due_date_time?: boolean,    // whether due_date includes a time
 *   custom_fields?: { id: string, value: unknown, value_options?: object }[],
 * }} task
 */
export function createTask(listId, task) {
  const body = { name: task.name };
  if (task.markdown_description) body.markdown_description = task.markdown_description;
  if (task.status) body.status = task.status;
  if (task.priority) body.priority = task.priority;
  if (task.assignees?.length) body.assignees = task.assignees;
  if (task.tags?.length) body.tags = task.tags;
  if (task.due_date) {
    body.due_date = task.due_date;
    body.due_date_time = !!task.due_date_time;
  }
  if (task.custom_fields?.length) body.custom_fields = task.custom_fields;
  return request(`/list/${listId}/task`, { method: 'POST', body });
}

export function createTaskComment(taskId, text, ref) {
  return request(`/task/${encodeURIComponent(taskId)}/comment`, {
    method: 'POST',
    query: taskQuery(ref),
    body: { comment_text: text, notify_all: false },
  });
}

/**
 * Uploads one file as a task attachment. Uses XHR (not fetch) so we get upload progress.
 * Retries on rate limiting like `request` does.
 * @param {string} taskId
 * @param {File} file
 * @param {(fraction: number) => void} [onProgress]
 * @param {{ customTaskIds?: boolean, teamId?: string }} [ref]
 */
export async function uploadAttachment(taskId, file, onProgress, ref) {
  const headers = await authHeader();
  const url = buildUrl(`/task/${encodeURIComponent(taskId)}/attachment`, taskQuery(ref));

  for (let attempt = 0; ; attempt++) {
    const result = await new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('attachment', file, file.name);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Authorization', headers.Authorization);
      xhr.responseType = 'json';

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve({ ok: true, body: xhr.response });
        else if (xhr.status === 429 && attempt < MAX_RETRIES) {
          resolve({ ok: false, waitMs: retryDelayMs((name) => xhr.getResponseHeader(name), attempt) });
        } else reject(toError(xhr.status, xhr.response));
      };
      xhr.onerror = () => reject(new ClickUpError('Network error while uploading.', 0));
      xhr.onabort = () => reject(new ClickUpError('Upload cancelled.', 0));

      xhr.send(form);
    });

    if (result.ok) return result.body;
    onProgress?.(0);
    await sleep(result.waitMs);
  }
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
