// The Brain tab: chat with ClickUp Brain (ClickUp's own AI) from the side panel. The public API at
// api.clickup.com has no Brain endpoint, so this uses ClickUp's private web-app API, captured from the
// app on 2026-10-29. That is undocumented and may break on any ClickUp deploy; everything here fails
// soft and nothing else in the extension depends on it. See ROADMAP.md and docs/privacy-policy.html.
//
// How ClickUp's own Brain chat works: each user has a private chat room of type ASK_AI whose members
// are the user and Brain (user id -4). A question is a comment in that room; Brain answers in the
// comment's thread (comment_type "ai"), and a follow-up is a reply in the same thread. So the chats
// started here also show up under "AI Chats" in ClickUp.
//
//  1. Session: a workspace-scoped token + the workspace's API host (lib/clickup-webapp.js,
//     sidepanel/webapp-session.js). All calls below go from the panel with `Authorization: Bearer`.
//  2. findBrainRoom(): GET <host>/chat/v1/workspaces/<ws>/chat/rooms/delta/0 → the ASK_AI room.
//  3. postQuestion(): POST <host>/comment-service/v3/workspaces/<ws>/comments/view/<room> (a new chat)
//     or …/comments/comment/<first comment> (a follow-up). A task is attached natively through the
//     `selectedItem` parameter in comment_type_data.query (brainQuery()).
//  4. waitForReply(): Brain's answer arrives complete (it is streamed only over a websocket on another
//     domain, which the CSP doesn't allow), so we poll the thread (comments/delta/0?parent_id=…) and,
//     meanwhile, the question's interaction_log, which carries Brain's progress ("Checking the task…").

import { gql, collect } from './clickup-gateway.js';

export const BRAIN_USER_ID = '-4';

export class BrainError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.name = 'BrainError';
    this.code = code;
    this.status = status;
  }
}

// --- pure helpers (unit-tested; no chrome/DOM) -----------------------------------------------

/**
 * comment_type_data.query of a question: Brain's options and the context it should read.
 * - `model`: 'auto' (Brain²) or a model's canonical id; `reasoning`: '' (Auto) or low|medium|high.
 * - `items`: tasks and docs to read (each sent as its own `selectedItem`); `taskId` is shorthand for one task.
 * - `attachmentIds`: files uploaded with uploadForBrain().
 * @param {{ model?: string, reasoning?: string, deepResearch?: boolean, attachmentIds?: string[],
 *           items?: { kind: 'task'|'doc', id: string }[], taskId?: string }} [opts]
 */
export function brainQuery({ model = 'auto', reasoning = '', deepResearch = false, attachmentIds = [], items = [], taskId } = {}) {
  const params = new URLSearchParams({ shouldTriage: 'false', createLink: 'false' });
  for (const id of attachmentIds) params.append('id', `attachment:${id}`);
  if (model && model !== 'auto') {
    params.set('AIToolId', 'ASSISTANT');
    params.set('selectedModel', model);
    if (reasoning) params.set('selectedReasoningLevel', reasoning);
  } else {
    params.set('selectedModel', 'auto');
  }
  if (deepResearch) params.set('deepResearch', 'true');
  const all = [...(taskId ? [{ kind: 'task', id: taskId }] : []), ...items];
  if (all.length === 1 && all[0].kind === 'task') {
    // What ClickUp's own "Ask about this task" sends besides the selected item.
    params.set('ancestor', `task:${all[0].id}`);
    params.set('uiContext', `task:${all[0].id}`);
  }
  for (const it of all) {
    params.append('selectedItem', JSON.stringify({ kind: 'location', context: it.kind === 'doc' ? 'doc' : 'task', contextId: String(it.id) }));
  }
  return `/?${params}`;
}

/** Plain text → the comment's rich-text ops (one text op and one newline op per line). */
export function textToOps(text) {
  const ops = [];
  for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    if (line) ops.push({ text: line, attributes: {} });
    ops.push({ text: '\n', attributes: {} });
  }
  return ops;
}

/** The comment op that puts an uploaded file in a question (as ClickUp's composer does). */
export function attachmentOp(att) {
  return {
    type: 'attachment',
    text: att.name,
    attachment: {
      id: att.id,
      name: att.name,
      title: att.title || att.name,
      type: att.mimetype,
      extension: att.extension,
      source: 1,
      mimetype: att.mimetype,
      date: att.date,
      thumbnail_large: att.thumbnail_large ?? null,
      thumbnail_medium: att.thumbnail_medium ?? null,
      thumbnail_small: att.thumbnail_small ?? null,
      url: att.url,
      uploaded: true,
    },
  };
}

/** The comment op that applies a skill (skills are tasks of custom type 5). */
export function skillOp(skill, workspaceId) {
  return {
    type: 'task_mention',
    attributes: {},
    task_mention: { task_id: String(skill.id), team_id: String(workspaceId), custom_type: 5, name: skill.name },
  };
}

/**
 * Body of a question comment: a new chat in the Brain room, or a follow-up in `threadId`'s thread.
 * Uploaded files come first, then the skill, then the text, like ClickUp's composer.
 * @param {{ text: string, roomId: string, threadId?: string, id: string, now: number, workspaceId?: string,
 *           attachments?: object[], skill?: { id: string, name: string } } & Parameters<typeof brainQuery>[0]} q
 */
export function questionBody({ text, roomId, threadId, id, now, workspaceId, attachments = [], skill, ...options }) {
  const parent = threadId ? String(threadId) : roomId;
  const type = threadId ? 2 : 8;
  const textOps = textToOps(skill ? ` ${text}` : text);
  const body = {
    comment: [...attachments.map(attachmentOp), ...(skill ? [skillOp(skill, workspaceId)] : []), ...textOps],
    id,
    root_parent_id: roomId,
    root_parent_type: 8,
    date: String(now),
    parent,
    type,
    key: `${type}_${parent}`,
    reactions: [],
    comment_type_data: { query: brainQuery({ ...options, attachmentIds: attachments.map((a) => a.id) }) },
    comment_date: now,
  };
  if (attachments.length) body.attachment_ids = attachments.map((a) => a.id);
  return body;
}

/** The ASK_AI room id from a chat rooms response, or null. */
export function findBrainRoomId(json) {
  const room = (json?.rooms || []).map((r) => r?.data).find((d) => d?.type === 'ASK_AI');
  return room?.id ? String(room.id) : null;
}

const commentsOf = (json) => (json?.comments || []).map((c) => c?.data || c).filter(Boolean);

/**
 * What Brain names as the trigger of its answer to a question: the question comment, or (when the
 * question carries files) the first uploaded file.
 */
export function questionTriggers(invokeId, attachmentIds = []) {
  return [`comment:${invokeId}`, ...attachmentIds.map((id) => `attachment:${id}`)];
}

/**
 * Brain's answer to the question `invokeId` from a thread response, or null while it is still working.
 * @param {string[]} [triggers]  from questionTriggers() when the question had files
 * @returns {{ id: string, text: string, ops: object[], conversationId: string|null } | null}
 */
export function pickReply(json, invokeId, triggers = questionTriggers(invokeId)) {
  const reply = commentsOf(json).find(
    (c) =>
      String(c.userid) === BRAIN_USER_ID && triggers.includes(c.extra?.triggered_on?.externalID) && (c.text_content || c.comment?.length),
  );
  if (!reply) return null;
  return {
    id: String(reply.id),
    text: reply.text_content || '',
    ops: Array.isArray(reply.comment) ? reply.comment : [],
    conversationId: reply.extra?.conversation_id ? String(reply.extra.conversation_id) : null,
  };
}

/** Brain's latest progress line ("Checking the task details") from the question comment, or ''. */
export function progressText(json, invokeId) {
  const question = commentsOf(json).find((c) => String(c.id) === String(invokeId));
  const steps = Object.values(question?.extra?.interaction_log || {}).flat();
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i]?.displayText) return String(steps[i].displayText);
  return '';
}

/** ClickUp's own view of a Brain conversation. */
export function conversationUrl(workspaceId, conversationId) {
  return `https://app.clickup.com/${workspaceId}/ai/brain?conversationId=${encodeURIComponent(conversationId)}`;
}

/** Turns a failed Brain call into a message a user can act on. */
export function brainError(status, payload) {
  const code = payload?.ECODE;
  const msg = payload?.err || payload?.error || '';
  if (status === 401 || /JWT_/.test(code || '')) {
    return new BrainError('Sign in to ClickUp in this browser, then try again.', { code, status });
  }
  if (status === 403) return new BrainError("ClickUp Brain isn't available to you in this workspace.", { code, status });
  if (status === 429) return new BrainError('ClickUp Brain is busy. Wait a moment, then try again.', { code, status });
  return new BrainError(msg || `ClickUp Brain didn't answer (HTTP ${status}).`, { code, status });
}

// --- networking (runs in the panel; `fetchImpl` is injectable for tests) ----------------------

async function call(session, path, { method = 'GET', body, headers = {}, signal, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`${session.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit',
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new BrainError('Network error while talking to ClickUp Brain.', { status: 0 });
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    // Kept (failure-only) so a future ClickUp change to this undocumented flow is easy to diagnose.
    console.warn('[brain] request rejected', { path: path.split('?')[0], status: res.status, code: json?.ECODE, err: json?.err });
    throw brainError(res.status, json);
  }
  return json;
}

const ws = (session) => encodeURIComponent(session.workspaceId);

/** The id of the user's Brain room in the session's workspace. */
export async function findBrainRoom(session, opts = {}) {
  const json = await call(session, `/chat/v1/workspaces/${ws(session)}/chat/rooms/delta/0?fields=members`, opts);
  const id = findBrainRoomId(json);
  if (!id) {
    throw new BrainError('Open ClickUp Brain once in ClickUp (the AI button), then try again here.', { code: 'NO_ROOM' });
  }
  return id;
}

/**
 * Posts a question; returns its comment id (the thread id, for a new chat).
 * @param {{ token: string, base: string, workspaceId: string }} session
 * @param {{ roomId: string, threadId?: string, text: string } & Omit<Parameters<typeof questionBody>[0], 'id' | 'now'>} q
 */
export async function postQuestion(session, q, opts = {}) {
  const { roomId, threadId } = q;
  const id = crypto.randomUUID();
  const body = questionBody({ workspaceId: session.workspaceId, ...q, id, now: Date.now() });
  const path = threadId
    ? `/comment-service/v3/workspaces/${ws(session)}/comments/comment/${encodeURIComponent(threadId)}`
    : `/comment-service/v3/workspaces/${ws(session)}/comments/view/${encodeURIComponent(roomId)}`;
  const json = await call(session, path, { ...opts, method: 'POST', body, headers: { 'Idempotency-Key': id } });
  if (json?.id == null) throw new BrainError("ClickUp didn't accept the question.", { status: 0 });
  return String(json.id);
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

/**
 * Polls until Brain has answered `invokeId` (in `threadId`'s thread). Rejects with an AbortError when
 * `signal` aborts (Brain itself keeps working; the answer still lands in ClickUp).
 * @param {{ threadId: string, invokeId: string, triggers?: string[], signal?: AbortSignal, onProgress?: (text:string)=>void,
 *           intervalMs?: number, timeoutMs?: number, fetchImpl?: typeof fetch }} opts
 */
export async function waitForReply(
  session,
  { threadId, invokeId, triggers = questionTriggers(invokeId), signal, onProgress, intervalMs = 1500, timeoutMs = 4 * 60 * 1000, fetchImpl },
) {
  const deadline = Date.now() + timeoutMs;
  const base = `/comment-service/v3/workspaces/${ws(session)}/comments`;
  let lastProgress = '';
  for (let i = 0; ; i++) {
    const thread = await call(session, `${base}/delta/0?parent_id=${encodeURIComponent(threadId)}&parent_type=comment`, {
      method: 'POST',
      body: { params: {} },
      signal,
      fetchImpl,
    });
    const reply = pickReply(thread, invokeId, triggers);
    if (reply) return reply;

    // Brain's progress steps, every other poll (they change slower than the thread).
    if (onProgress && i % 2 === 0) {
      const q = await call(session, `${base}/bulk`, { method: 'POST', body: { ids: [String(invokeId)] }, signal, fetchImpl }).catch(
        (err) => {
          if (err?.name === 'AbortError') throw err;
          return null;
        },
      );
      const text = progressText(q, invokeId);
      if (text && text !== lastProgress) onProgress((lastProgress = text));
    }
    if (Date.now() > deadline) {
      throw new BrainError('ClickUp Brain is taking a long time. Its answer will appear in ClickUp.', { code: 'TIMEOUT' });
    }
    await sleep(intervalMs, signal);
  }
}

// --- models (GraphQL gateway, lib/clickup-gateway.js) ------------------------------------------

export const MODELS_QUERY = 'query aiModels { getAIModels }';

/**
 * The models Brain's chat offers (ClickUp's types `brain` and `agent`), Brain² first. `id` is what a
 * question sends as selectedModel: 'auto' for Brain², else the model's canonical id.
 * @returns {{ id: string, name: string, description: string, lab: string, premium: boolean, canUse: boolean,
 *             badge: string, reasoning: { key: string, label: string }[], attachments: object|null }[]}
 */
export function parseModels(data) {
  const out = [];
  const seen = new Set();
  for (const m of data?.getAIModels || []) {
    if (m?.type !== 'brain' && m?.type !== 'agent') continue;
    const id = m.type === 'brain' ? 'auto' : String(m.canonicalId || m.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: String(m.name || id),
      description: String(m.description || ''),
      lab: String(m.lab || m.provider || ''),
      premium: !!m.isPremium,
      canUse: m.canUse !== false,
      badge: String(m.badge || ''),
      reasoning: (m.reasoningLevels || []).filter((r) => r?.key).map((r) => ({ key: String(r.key), label: String(r.label || r.key) })),
      attachments: (m.features || []).find((f) => f?.name === 'attachments')?.config || null,
    });
  }
  return out.sort((a, b) => (b.id === 'auto') - (a.id === 'auto'));
}

export async function listModels(gateway, opts) {
  return parseModels(await gql(gateway, 'aiModels', MODELS_QUERY, {}, opts));
}

// --- search: tasks and docs to give Brain as context (a gateway subscription) -----------------

export const SEARCH_QUERY =
  'subscription LightSearchSubscription($q: String!, $limit: Int) { result: search(q: $q, limit: $limit, source: LOCAL) ' +
  '{ items { ent { id title url type ... on Asset { externalID data } } } } }';

/** The search `q` for tasks or docs matching `keywords` (most recent first when empty). */
export function searchQ(keywords, kind) {
  const params = new URLSearchParams();
  if (keywords.trim()) params.set('keywords', keywords.trim());
  params.set('app', 'clickupunified');
  params.set('assetType', kind === 'doc' ? 'document' : 'task');
  if (!keywords.trim()) params.set('sort', '-user_recents');
  return `/?${params}`;
}

/**
 * Search results (the `data` of each update) → unique { kind, id, name, url, status, color }.
 * @returns {{ kind: 'task'|'doc', id: string, name: string, url: string, status: string, color: string }[]}
 */
export function parseSearch(updates) {
  const out = new Map();
  for (const data of updates || []) {
    for (const item of data?.result?.items || []) {
      const ent = item?.ent;
      const m = /^(task|doc):(.+)$/.exec(String(ent?.externalID || ''));
      if (!m || out.has(m[0])) continue;
      let extra = {};
      try {
        extra = JSON.parse(ent.data || '{}') || {};
      } catch {
        /* no details */
      }
      out.set(m[0], {
        kind: m[1],
        id: m[2],
        name: String(ent.title || m[2]),
        url: typeof ent.url === 'string' ? ent.url : '',
        status: String(extra.status_raw || ''),
        color: /^#[0-9a-f]{3,8}$/i.test(extra.status_color || '') ? extra.status_color : '',
      });
    }
  }
  return [...out.values()];
}

/** Tasks then docs matching `keywords` (up to `limit` of each). */
export async function searchItems(socket, keywords, { limit = 6, signal } = {}) {
  const [tasks, docs] = await Promise.all(
    ['task', 'doc'].map((kind) => collect(socket, SEARCH_QUERY, { q: searchQ(keywords, kind), limit }, { signal }).catch(() => [])),
  );
  return [...parseSearch(tasks).slice(0, limit), ...parseSearch(docs).slice(0, limit)];
}

// --- files ------------------------------------------------------------------------------------

/** What Brain² accepts (ClickUp's model features, 2026-10-29), used when the model list has none. */
export const DEFAULT_FILE_RULES = {
  images: { maxSizeBytes: 21_000_000, supportedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] },
  file: {
    maxSizeBytes: 25_000_000,
    supportedMimeTypes: ['application/pdf', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  },
  text: { maxFileSizeLength: 20_000, supportedMimeTypes: ['text/csv', 'text/plain', 'text/markdown', 'text/x-markdown', 'application/json'] },
};

const EXT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', json: 'application/json',
};

/** A file's MIME type, from its name when the browser didn't say. */
export function fileType(file) {
  if (file?.type) return file.type;
  const ext = /\.([a-z0-9]+)$/i.exec(file?.name || '')?.[1]?.toLowerCase();
  return EXT_TYPES[ext] || '';
}

/**
 * Whether Brain can take this file.
 * @returns {{ ok: true, mimetype: string } | { ok: false, reason: string }}
 */
export function brainFileRule(file, rules = DEFAULT_FILE_RULES) {
  const mimetype = fileType(file);
  const mb = (n) => `${Math.round(n / 1_000_000)} MB`;
  const r = rules || DEFAULT_FILE_RULES;
  if (r.images?.supportedMimeTypes?.includes(mimetype)) {
    return file.size <= r.images.maxSizeBytes ? { ok: true, mimetype } : { ok: false, reason: `Images can be up to ${mb(r.images.maxSizeBytes)}.` };
  }
  if (r.file?.supportedMimeTypes?.includes(mimetype)) {
    return file.size <= r.file.maxSizeBytes ? { ok: true, mimetype } : { ok: false, reason: `Files can be up to ${mb(r.file.maxSizeBytes)}.` };
  }
  if (r.text?.supportedMimeTypes?.includes(mimetype)) {
    // The limit is in characters; 4 bytes per character is the most UTF-8 can take.
    const max = (r.text.maxFileSizeLength || 20_000) * 4;
    return file.size <= max ? { ok: true, mimetype } : { ok: false, reason: `Text files can be up to ${r.text.maxFileSizeLength || 20_000} characters.` };
  }
  return { ok: false, reason: 'Brain² takes images (JPG, PNG, WebP), PDFs, spreadsheets and text files (TXT, MD, CSV, JSON).' };
}

/**
 * Uploads a file for a question (XHR, for progress). Resolves to what attachmentOp() needs.
 * @param {{ session: { token: string, base: string }, roomId: string, file: File, onProgress?: (f: number) => void, signal?: AbortSignal }} opts
 */
export function uploadForBrain({ session, roomId, file, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('attachment', file, file.name);
    form.append('type', '8');
    form.append('parent', roomId);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${session.base}/v1/attachment`);
    xhr.setRequestHeader('Authorization', `Bearer ${session.token}`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const payload = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300 && payload?.id) {
        resolve({ ...payload, mimetype: fileType(file) });
      } else {
        console.warn('[brain] upload rejected', { status: xhr.status, code: payload?.ECODE });
        reject(brainError(xhr.status, payload));
      }
    };
    xhr.onerror = () => reject(new BrainError('Network error while uploading the file.', { status: 0 }));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

// --- skills -----------------------------------------------------------------------------------

/** The hidden list that holds the workspace's Brain skills (tasks of custom type 5), or null. */
export async function skillsListId(session, opts = {}) {
  const json = await call(session, `/data/v3/workspaces/${ws(session)}/feature_entities/ai_skills`, opts);
  return json?.list_id ? String(json.list_id) : null;
}

/** Public-API tasks of the skills list → { id, name, summary }. */
export function parseSkills(tasks) {
  return (tasks || [])
    .filter((t) => t?.id && t?.name && !t.archived)
    .map((t) => ({ id: String(t.id), name: String(t.name), summary: String(t.text_content || t.description || '').split('\n')[0].slice(0, 140) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- the answer as it is written (gateway subscriptions) --------------------------------------

export const RUNS_QUERY = 'subscription ActiveAgentRuns($query: String!) { activeAgentRuns(query: $query) { conversationId status invokeId } }';
export const STATUS_QUERY =
  'subscription AiConversationStatus($conversationID: String!) { aiConversationStatus(conversationID: $conversationID) ' +
  '{ status result { id answer answerComplete } } }';

/**
 * Follows Brain's answer to `invokeId` as it is written: `onText(markdown)` gets the growing answer.
 * Resolves with { conversationId, text } when it is complete; rejects with an AbortError on abort.
 * The finished, formatted answer still comes from the thread (waitForReply).
 */
export function watchAnswer(socket, { roomId, invokeId, triggers = questionTriggers(invokeId), onText, signal }) {
  return new Promise((resolve, reject) => {
    const stops = [];
    let done = false;
    let following = false;
    let latest = '';
    const finish = (err, value) => {
      if (done) return;
      done = true;
      stops.forEach((s) => s());
      if (err) reject(err);
      else resolve(value);
    };
    const keep = (p) =>
      p.then(
        (stop) => (done ? stop() : stops.push(stop)),
        (err) => finish(err),
      );
    signal?.addEventListener('abort', () => finish(new DOMException('Aborted', 'AbortError')), { once: true });

    const follow = (conversationId) => {
      following = true;
      keep(
        socket.subscribe(STATUS_QUERY, { conversationID: conversationId }, {
          next: (payload) => {
            const s = payload?.data?.aiConversationStatus;
            const answer = s?.result?.answer;
            if (typeof answer === 'string' && answer) {
              latest = answer;
              onText?.(answer);
            }
            if (/^(COMPLETED?|DONE|SUCCEEDED|SUCCESS)$/.test(s?.status || '') || s?.result?.answerComplete) {
              finish(null, { conversationId, text: latest });
            }
            else if (s?.status === 'FAILED' || s?.status === 'CANCELLED') finish(new BrainError('ClickUp Brain stopped without an answer.'));
          },
          error: (err) => finish(err),
          // The stream may just end once the answer is written.
          complete: () => finish(null, { conversationId, text: latest }),
        }),
      );
    };
    keep(
      socket.subscribe(RUNS_QUERY, { query: `/?id=${encodeURIComponent(`view:${roomId}`)}` }, {
        next: (payload) => {
          const run = (payload?.data?.activeAgentRuns || []).find((r) => triggers.includes(r?.invokeId));
          if (run?.conversationId && !following) follow(String(run.conversationId));
        },
        error: (err) => finish(err),
      }),
    );
  });
}
