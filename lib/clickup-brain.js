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

/** comment_type_data.query of a question: Brain's options, plus the task to talk about if any. */
export function brainQuery({ taskId } = {}) {
  const params = new URLSearchParams({ shouldTriage: 'false', createLink: 'false', selectedModel: 'auto' });
  if (taskId) {
    params.set('ancestor', `task:${taskId}`);
    params.set('uiContext', `task:${taskId}`);
    params.set('selectedItem', JSON.stringify({ kind: 'location', context: 'task', contextId: String(taskId) }));
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

/**
 * Body of a question comment: a new chat in the Brain room, or a follow-up in `threadId`'s thread.
 * @param {{ text: string, roomId: string, threadId?: string, taskId?: string, id: string, now: number }} q
 */
export function questionBody({ text, roomId, threadId, taskId, id, now }) {
  const parent = threadId ? String(threadId) : roomId;
  const type = threadId ? 2 : 8;
  return {
    comment: textToOps(text),
    id,
    root_parent_id: roomId,
    root_parent_type: 8,
    date: String(now),
    parent,
    type,
    key: `${type}_${parent}`,
    reactions: [],
    comment_type_data: { query: brainQuery({ taskId }) },
    comment_date: now,
  };
}

/** The ASK_AI room id from a chat rooms response, or null. */
export function findBrainRoomId(json) {
  const room = (json?.rooms || []).map((r) => r?.data).find((d) => d?.type === 'ASK_AI');
  return room?.id ? String(room.id) : null;
}

const commentsOf = (json) => (json?.comments || []).map((c) => c?.data || c).filter(Boolean);

/**
 * Brain's answer to the question `invokeId` from a thread response, or null while it is still working.
 * @returns {{ id: string, text: string, ops: object[], conversationId: string|null } | null}
 */
export function pickReply(json, invokeId) {
  const trigger = `comment:${invokeId}`;
  const reply = commentsOf(json).find(
    (c) => String(c.userid) === BRAIN_USER_ID && c.extra?.triggered_on?.externalID === trigger && (c.text_content || c.comment?.length),
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
 * @param {{ roomId: string, threadId?: string, text: string, taskId?: string }} q
 */
export async function postQuestion(session, { roomId, threadId, text, taskId }, opts = {}) {
  const id = crypto.randomUUID();
  const body = questionBody({ text, roomId, threadId, taskId, id, now: Date.now() });
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
 * @param {{ threadId: string, invokeId: string, signal?: AbortSignal, onProgress?: (text:string)=>void,
 *           intervalMs?: number, timeoutMs?: number, fetchImpl?: typeof fetch }} opts
 */
export async function waitForReply(session, { threadId, invokeId, signal, onProgress, intervalMs = 1500, timeoutMs = 4 * 60 * 1000, fetchImpl }) {
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
    const reply = pickReply(thread, invokeId);
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
