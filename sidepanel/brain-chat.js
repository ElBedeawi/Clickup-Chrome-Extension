// The Brain tab: a chat with ClickUp Brain over ClickUp's private web-app API (lib/clickup-brain.js).
// The conversation lives in ClickUp (it also shows under "AI Chats" there); this panel keeps only what
// is on screen, in memory. Optionally attaches the task found on the Existing tab, which Brain then
// reads itself (ClickUp's native task context, not text pasted into the question).

import { findBrainRoom, postQuestion, waitForReply, conversationUrl } from '../lib/clickup-brain.js';
import { renderOps } from '../lib/quill-render.js';
import { getSession, dropSession } from './webapp-session.js';

const $ = (id) => document.getElementById(id);

/**
 * @param {{ getWorkspace: () => ({ id: string, name: string, many: boolean } | null) }} opts
 *   the workspace selected in the panel (a new chat starts there unless a task is attached)
 */
export function createBrainChat({ getWorkspace }) {
  const el = {
    intro: $('brain-intro'),
    where: $('brain-where'),
    log: $('brain-log'),
    task: $('brain-task'),
    taskName: $('brain-task-name'),
    input: $('brain-input'),
    send: $('brain-send'),
    reset: $('brain-new'),
    open: $('brain-open'),
  };

  /** The conversation on screen: where it lives in ClickUp. */
  let chat = { workspaceId: null, roomId: null, threadId: null, conversationId: null };
  /** The task offered as context (from the Existing tab), and whether the chip is on. */
  let task = null;
  let useTask = false;
  /** Set while a question is out; aborting stops waiting (Brain itself finishes in ClickUp). */
  let inflight = null;
  /** Bumped by New chat, so a question still settling can't write into the new conversation. */
  let generation = 0;

  function renderWhere() {
    const ws = getWorkspace();
    const show = !chat.workspaceId && ws?.many && ws.name && !(useTask && task);
    el.where.hidden = !show;
    if (show) el.where.textContent = `Asks Brain in ${ws.name}.`;
  }

  function renderTask() {
    el.task.hidden = !task;
    el.task.setAttribute('aria-pressed', String(!!task && useTask));
    el.task.title = useTask ? 'Brain reads this task with your question. Click to leave it out.' : 'Click to ask Brain about this task.';
    if (task) el.taskName.textContent = task.name;
    renderWhere();
  }

  function renderBusy() {
    const busy = !!inflight;
    el.send.textContent = '';
    el.send.append(busy ? 'Stop' : 'Ask');
    el.send.classList.toggle('primary', !busy);
    el.send.classList.toggle('secondary', busy);
    el.send.title = busy ? 'Stop waiting for this answer' : 'Ask Brain (Enter)';
    el.input.disabled = busy;
  }

  function scrollToEnd() {
    el.log.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }

  function addMessage(role, text) {
    const li = document.createElement('li');
    li.className = `brain-msg ${role}`;
    if (text) {
      const p = document.createElement('p');
      p.textContent = text;
      li.append(p);
    }
    el.log.append(li);
    el.intro.hidden = true;
    scrollToEnd();
    return li;
  }

  function setPending(li, text) {
    li.classList.add('pending');
    li.textContent = '';
    const span = document.createElement('span');
    span.className = 'brain-dots';
    span.textContent = text || 'Thinking…';
    li.append(span);
  }

  function setFailed(li, message) {
    li.className = 'brain-msg failed';
    li.textContent = '';
    const p = document.createElement('p');
    p.textContent = message;
    li.append(p);
  }

  /** Runs `fn(session)`; on a 401 (expired token) mints a new token once and runs it again. */
  async function withSession(workspaceId, fn) {
    try {
      return await fn(await getSession({ workspaceId }));
    } catch (err) {
      if (err?.status !== 401) throw err;
      dropSession(workspaceId);
      return fn(await getSession({ workspaceId }));
    }
  }

  async function ask() {
    const text = el.input.value.trim();
    if (!text || inflight) return;
    const withTask = useTask && task ? task : null;
    const workspaceId = chat.workspaceId || withTask?.teamId || getWorkspace()?.id;
    if (!workspaceId) {
      const li = addMessage('brain', '');
      setFailed(li, 'Pick a workspace on the New task tab first.');
      return;
    }

    const userLi = addMessage('user', text);
    if (withTask) {
      const note = document.createElement('p');
      note.className = 'brain-about';
      note.textContent = `About: ${withTask.name}`;
      userLi.append(note);
    }
    const replyLi = addMessage('brain', '');
    setPending(replyLi);
    el.input.value = '';
    inflight = new AbortController();
    const { signal } = inflight;
    renderBusy();

    const gen = generation;
    const current = () => gen === generation; // false once New chat replaced this conversation
    let posted = false;
    let ids = { roomId: chat.roomId, threadId: chat.threadId, invokeId: null };
    try {
      const reply = await withSession(workspaceId, async (session) => {
        if (!posted) {
          const roomId = ids.roomId || (await findBrainRoom(session, { signal }));
          const invokeId = await postQuestion(session, { roomId, threadId: ids.threadId, text, taskId: withTask?.id }, { signal });
          posted = true;
          ids = { roomId, threadId: ids.threadId || invokeId, invokeId };
          if (current()) chat = { ...chat, workspaceId, roomId, threadId: ids.threadId };
        }
        return waitForReply(session, {
          threadId: ids.threadId,
          invokeId: ids.invokeId,
          signal,
          onProgress: (step) => setPending(replyLi, step),
        });
      });
      if (!current()) return;
      replyLi.className = 'brain-msg brain';
      replyLi.textContent = '';
      const body = reply.ops.length ? renderOps(reply.ops, document, { workspaceId }) : null;
      if (body?.childNodes.length) {
        body.className = 'brain-body';
        replyLi.append(body);
      } else {
        const p = document.createElement('p');
        p.textContent = reply.text || '(No answer)';
        replyLi.append(p);
      }
      if (reply.conversationId) {
        chat.conversationId = reply.conversationId;
        el.open.href = conversationUrl(workspaceId, reply.conversationId);
        el.open.hidden = false;
      }
    } catch (err) {
      if (!current()) return; // its messages are gone with the old chat
      if (err?.name === 'AbortError') {
        if (posted) {
          setFailed(replyLi, 'Stopped waiting. Brain may still answer this in ClickUp.');
        } else {
          // Nothing reached ClickUp: take the question back off the screen and into the box.
          userLi.remove();
          replyLi.remove();
          el.input.value = text;
          if (!el.log.children.length) el.intro.hidden = false;
        }
      } else {
        setFailed(replyLi, err?.message || 'ClickUp Brain could not answer.');
        // Nothing reached ClickUp: give the question back so it can be sent again.
        if (!posted) {
          userLi.remove();
          el.input.value = text;
        }
        if (!(err?.status >= 400) && !err?.code) console.warn('[brain]', err);
      }
    } finally {
      inflight = null;
      renderBusy();
      renderWhere();
      scrollToEnd();
      if (!el.input.disabled) el.input.focus();
    }
  }

  function reset() {
    generation++;
    inflight?.abort();
    chat = { workspaceId: null, roomId: null, threadId: null, conversationId: null };
    el.log.textContent = '';
    el.intro.hidden = false;
    el.open.hidden = true;
    el.input.value = '';
    renderWhere();
    el.input.focus();
  }

  el.send.addEventListener('click', () => (inflight ? inflight.abort() : ask()));
  el.reset.addEventListener('click', reset);
  el.task.addEventListener('click', () => {
    useTask = !useTask;
    renderTask();
  });
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      ask();
    }
  });

  renderBusy();
  renderTask();

  return {
    /** The task found on the Existing tab, or null when there is none. Turning it on is up to the user. */
    setTask(next) {
      const changed = next?.id !== task?.id;
      task = next || null;
      if (changed) useTask = false;
      renderTask();
    },
    /** Workspace list or selection changed. */
    refresh: renderWhere,
    focus() {
      if (!el.input.disabled) el.input.focus();
    },
  };
}
