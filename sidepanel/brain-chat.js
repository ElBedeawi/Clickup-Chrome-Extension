// The Brain² tab: a chat with ClickUp Brain over ClickUp's private web-app API (lib/clickup-brain.js),
// laid out like ClickUp's own Brain² composer: context chips, the question, then + (Deep Research,
// tasks and docs, files), Skills, the model and Send. The conversation lives in ClickUp (it also shows
// under "AI Chats" there); this panel keeps only what is on screen, in memory.

import {
  findBrainRoom,
  postQuestion,
  waitForReply,
  watchAnswer,
  conversationUrl,
  questionTriggers,
  listModels,
  searchItems,
  brainFileRule,
  uploadForBrain,
  skillsListId,
  parseSkills,
  DEFAULT_FILE_RULES,
} from '../lib/clickup-brain.js';
import { getGateway, dropGateway, createGatewaySocket } from '../lib/clickup-gateway.js';
import { renderOps } from '../lib/quill-render.js';
import { getTask, getListTasks } from '../lib/clickup-api.js';
import { getPrefs, setPrefs } from '../lib/storage.js';
import { icon, brainLogo } from '../lib/icons.js';
import { getSession, dropSession } from './webapp-session.js';

const $ = (id) => document.getElementById(id);
const BRAIN = { id: 'auto', name: 'Brain²', reasoning: '' };

/** A small element: h('span', { className: 'x', title: 'y' }, ...children). Text children become text nodes. */
function h(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children.flat()) if (child != null && child !== false) node.append(child);
  return node;
}
const svg = (name, size = 16) => h('span', { className: 'ic', innerHTML: icon(name, size) }).firstChild;

/**
 * @param {{ getWorkspace: () => ({ id: string, name: string, many: boolean } | null) }} opts
 *   the workspace selected in the panel (a new chat starts there unless an attached task says otherwise)
 */
export function createBrainChat({ getWorkspace }) {
  const el = {
    intro: $('brain-intro'),
    where: $('brain-where'),
    log: $('brain-log'),
    chips: $('brain-chips'),
    input: $('brain-input'),
    send: $('brain-send'),
    reset: $('brain-new'),
    open: $('brain-open'),
    plus: $('brain-plus'),
    skills: $('brain-skills'),
    research: $('brain-research'),
    model: $('brain-model'),
    modelLabel: $('brain-model-label'),
    pop: $('brain-pop'),
    file: $('brain-file'),
    composer: document.querySelector('.brain-composer'),
  };

  /** The conversation on screen: where it lives in ClickUp. */
  let chat = { workspaceId: null, roomId: null, threadId: null, conversationId: null };
  /**
   * What goes with the next question. Items are tasks/docs ({ kind, id, name, color, teamId }); files
   * upload as soon as they are added ({ key, name, status: 'uploading'|'done'|'failed', progress, att, error }).
   */
  let draft = { items: [], files: [], skill: null, deepResearch: false };
  /** The chosen model (remembered in prefs.brain). */
  let model = { ...BRAIN };
  /** The task found on the Existing tab, offered as a one-click chip. */
  let suggested = null;
  /** Set while a question is out; aborting stops waiting (Brain itself finishes in ClickUp). */
  let inflight = null;
  /** Bumped by New chat, so a question still settling can't write into the new conversation. */
  let generation = 0;
  let fileSeq = 0;

  const rooms = new Map(); // workspaceId → Brain room id
  const sockets = new Map(); // workspaceId → gateway socket
  const modelLists = new Map(); // workspaceId → Promise<models>
  const skillLists = new Map(); // workspaceId → Promise<skills>
  const taskInfo = new Map(); // task id → Promise<{ name, color } | null>

  // --- workspace, session, gateway -----------------------------------------------------------

  function currentWorkspace() {
    return chat.workspaceId || draft.items.find((i) => i.teamId)?.teamId || getWorkspace()?.id || null;
  }

  /** Runs `fn(session)`; on a 401 (expired token) mints a new token once and runs it again. */
  async function withSession(workspaceId, fn) {
    try {
      return await fn(await getSession({ workspaceId }));
    } catch (err) {
      if (err?.status !== 401) throw err;
      dropSession(workspaceId);
      dropGateway(workspaceId);
      return fn(await getSession({ workspaceId }));
    }
  }

  async function roomFor(session, signal) {
    if (!rooms.has(session.workspaceId)) rooms.set(session.workspaceId, await findBrainRoom(session, { signal }));
    return rooms.get(session.workspaceId);
  }

  function socketFor(workspaceId) {
    if (!sockets.has(workspaceId)) {
      sockets.set(workspaceId, createGatewaySocket({ getGateway: async () => getGateway(await getSession({ workspaceId })) }));
    }
    return sockets.get(workspaceId);
  }

  function modelsFor(workspaceId) {
    if (!modelLists.has(workspaceId)) {
      const p = withSession(workspaceId, async (session) => listModels(await getGateway(session)));
      p.then(
        (models) => (lastBrainRules = models.find((m) => m.id === 'auto')?.attachments || lastBrainRules),
        () => modelLists.delete(workspaceId), // try again next time
      );
      modelLists.set(workspaceId, p);
    }
    return modelLists.get(workspaceId);
  }

  function skillsFor(workspaceId) {
    if (!skillLists.has(workspaceId)) {
      const p = withSession(workspaceId, async (session) => {
        const listId = await skillsListId(session);
        return listId ? parseSkills(await getListTasks(listId)) : [];
      });
      p.catch(() => skillLists.delete(workspaceId));
      skillLists.set(workspaceId, p);
    }
    return skillLists.get(workspaceId);
  }

  /** A task's name and status colour through the public API (cached), for mention chips. */
  function lookupTask(id) {
    if (!taskInfo.has(id)) {
      taskInfo.set(
        id,
        getTask(id)
          .then((t) => ({ name: t.name, color: t.status?.color || '' }))
          .catch(() => null),
      );
    }
    return taskInfo.get(id);
  }

  // --- rendering: chips, bar, where -----------------------------------------------------------

  function chip({ iconName, color, label, title, onRemove, extra, className = '' }) {
    const node = h('span', { className: `brain-chip ${className}`.trim(), title: title || label });
    if (color !== undefined) {
      const dot = h('span', { className: 'dot' });
      if (color) dot.style.setProperty('--chip-color', color);
      node.append(dot);
    } else if (iconName) node.append(svg(iconName, 13));
    node.append(h('span', { className: 'label', textContent: label }));
    if (extra) node.append(extra);
    if (onRemove) {
      const x = h('button', { type: 'button', className: 'x', title: 'Remove', ariaLabel: `Remove ${label}` }, svg('x', 12));
      x.addEventListener('click', onRemove);
      node.append(x);
    }
    return node;
  }

  /** The chips of a draft (editable in the composer, read-only in a sent message). */
  function draftChips(d, editable) {
    const out = [];
    if (d.skill) {
      out.push(chip({ iconName: 'slash', label: d.skill.name, onRemove: editable && (() => setDraft({ skill: null })) }));
    }
    for (const it of d.items) {
      out.push(
        chip({
          iconName: it.kind === 'doc' ? 'doc' : undefined,
          color: it.kind === 'task' ? it.color || '' : undefined,
          label: it.name,
          onRemove: editable && (() => setDraft({ items: draft.items.filter((x) => x !== it) })),
        }),
      );
    }
    for (const f of d.files) {
      const pct = f.status === 'uploading' ? h('span', { className: 'pct', textContent: `${Math.round((f.progress || 0) * 100)}%` }) : null;
      out.push(
        chip({
          iconName: 'file',
          label: f.name,
          title: f.status === 'failed' ? `${f.name}: ${f.error}` : f.name,
          className: f.status === 'failed' ? 'failed' : '',
          extra: pct,
          onRemove: editable && (() => {
            f.ctl?.abort();
            setDraft({ files: draft.files.filter((x) => x !== f) });
          }),
        }),
      );
    }
    if (d.deepResearch && !editable) out.push(chip({ iconName: 'research', label: 'Deep Research' }));
    return out;
  }

  function renderChips() {
    const nodes = draftChips(draft, true);
    if (suggested && !draft.items.some((i) => i.kind === 'task' && i.id === suggested.id)) {
      const add = h('button', { type: 'button', className: 'brain-chip suggest', title: `Ask Brain² about ${suggested.name}` }, svg('plus', 12), h('span', { className: 'label', textContent: suggested.name }));
      add.addEventListener('click', () => addItem({ kind: 'task', id: suggested.id, name: suggested.name, teamId: suggested.teamId, color: suggested.color || '' }));
      nodes.push(add);
    }
    el.chips.replaceChildren(...nodes);
  }

  function renderBar() {
    el.research.hidden = !draft.deepResearch;
    const effort = model.reasoning ? ` · ${model.reasoning[0].toUpperCase()}${model.reasoning.slice(1)}` : '';
    el.modelLabel.textContent = `${model.name}${effort}`;
    el.model.title = `Model: ${model.name}${effort}`;
    const busy = !!inflight;
    const uploading = draft.files.some((f) => f.status === 'uploading');
    el.send.innerHTML = icon(busy ? 'stop' : 'arrowUp', 16);
    el.send.title = busy ? 'Stop waiting for this answer' : uploading ? 'Waiting for the files to upload…' : 'Ask (Enter)';
    el.send.setAttribute('aria-label', busy ? 'Stop' : 'Ask Brain²');
    el.send.disabled = !busy && (uploading || !el.input.value.trim());
    el.input.disabled = busy;
  }

  function renderWhere() {
    const ws = getWorkspace();
    const show = !chat.workspaceId && ws?.many && ws.name && !draft.items.some((i) => i.teamId && i.teamId !== ws.id);
    el.where.hidden = !show;
    if (show) el.where.textContent = `Asks Brain² in ${ws.name}.`;
  }

  function setDraft(patch) {
    draft = { ...draft, ...patch };
    renderChips();
    renderBar();
    renderWhere();
  }

  function addItem(item) {
    if (draft.items.some((i) => i.kind === item.kind && i.id === item.id)) return;
    setDraft({ items: [...draft.items, item] });
  }

  // --- popovers -------------------------------------------------------------------------------

  let pop = null; // 'plus' | 'skills' | 'model'
  const popButtons = { plus: el.plus, skills: el.skills, model: el.model };

  function closePop() {
    pop = null;
    el.pop.hidden = true;
    el.pop.replaceChildren();
    for (const b of Object.values(popButtons)) b.setAttribute('aria-expanded', 'false');
  }

  function openPop(kind) {
    if (pop === kind) return closePop();
    pop = kind;
    for (const [k, b] of Object.entries(popButtons)) b.setAttribute('aria-expanded', String(k === kind));
    el.pop.hidden = false;
    el.pop.replaceChildren();
    ({ plus: buildPlus, skills: buildSkills, model: buildModel })[kind]();
    placePop();
  }

  /** Opens upward like ClickUp's, unless there's too little room above the composer (then downward). */
  function placePop() {
    const above = el.composer.getBoundingClientRect().top - 8;
    const below = window.innerHeight - el.composer.getBoundingClientRect().bottom - 8;
    const down = above < 220 && below > above;
    el.pop.classList.toggle('down', down);
    el.pop.style.maxHeight = `${Math.max(160, Math.min(380, down ? below : above))}px`;
  }

  function row({ iconName, logo, color, name, sub, after, onClick, disabled, checked, role }) {
    const b = h('button', { type: 'button', className: 'brain-row', disabled: !!disabled });
    if (role) b.setAttribute('role', role);
    if (checked !== undefined) b.setAttribute('aria-checked', String(!!checked));
    if (logo) b.append(h('span', { className: 'ic', innerHTML: brainLogo(18) }).firstChild);
    else if (color !== undefined) {
      const dot = h('span', { className: 'dot' });
      if (color) dot.style.setProperty('--chip-color', color);
      b.append(dot);
    } else if (iconName) b.append(svg(iconName, 16));
    b.append(h('span', { className: 'main' }, h('span', { className: 'name', textContent: name }), sub ? h('span', { className: 'sub', textContent: sub }) : null));
    for (const a of [].concat(after || [])) if (a) b.append(a);
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  const note = (text) => h('p', { className: 'note', textContent: text });
  const heading = (text) => h('h3', { textContent: text });

  function buildPlus() {
    const research = row({
      iconName: 'research',
      name: 'Deep Research',
      sub: 'A longer, thorough answer',
      role: 'menuitemcheckbox',
      checked: draft.deepResearch,
      after: h('span', { className: 'switch' }),
      onClick: () => {
        setDraft({ deepResearch: !draft.deepResearch });
        research.setAttribute('aria-checked', String(draft.deepResearch));
      },
    });
    const search = h('input', { type: 'search', placeholder: 'Search tasks and docs…', ariaLabel: 'Search tasks and docs' });
    const results = h('div', { className: 'brain-results' });
    const shortcut = [];
    if (suggested && !draft.items.some((i) => i.kind === 'task' && i.id === suggested.id)) {
      shortcut.push(
        row({
          color: suggested.color || '',
          name: suggested.name,
          sub: 'Task from the Existing task tab',
          onClick: () => {
            addItem({ kind: 'task', id: suggested.id, name: suggested.name, teamId: suggested.teamId, color: suggested.color || '' });
            closePop();
          },
        }),
      );
    }
    results.replaceChildren(...shortcut, note('Type to search your tasks and docs.'));
    let timer = 0;
    let searchCtl = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      const q = search.value.trim();
      if (!q) {
        results.replaceChildren(...shortcut, note('Type to search your tasks and docs.'));
        return;
      }
      timer = setTimeout(async () => {
        searchCtl?.abort();
        searchCtl = new AbortController();
        const { signal } = searchCtl;
        results.replaceChildren(note('Searching…'));
        const ws = currentWorkspace();
        try {
          const found = await searchItems(socketFor(ws), q, { signal });
          if (signal.aborted || pop !== 'plus') return;
          results.replaceChildren(
            ...(found.length
              ? found.map((it) =>
                  row({
                    iconName: it.kind === 'doc' ? 'doc' : undefined,
                    color: it.kind === 'task' ? it.color : undefined,
                    name: it.name,
                    sub: it.kind === 'doc' ? 'Doc' : it.status || 'Task',
                    onClick: () => {
                      addItem({ kind: it.kind, id: it.id, name: it.name, color: it.color, teamId: ws });
                      closePop();
                    },
                  }),
                )
              : [note('Nothing found.')]),
          );
        } catch (err) {
          if (err?.name !== 'AbortError' && pop === 'plus') results.replaceChildren(note(`Search isn't available: ${err?.message || err}`));
        }
      }, 300);
    });
    const upload = row({ iconName: 'paperclip', name: 'Upload files', sub: 'Images, PDFs, spreadsheets, text', onClick: () => (closePop(), el.file.click()) });
    el.pop.append(heading('Modes'), research, heading('Add tasks and docs'), search, results, heading('Files'), upload);
    search.focus();
  }

  function buildSkills() {
    const ws = currentWorkspace();
    const filter = h('input', { type: 'search', placeholder: 'Search skills…', ariaLabel: 'Search skills' });
    const list = h('div', { className: 'brain-results' }, note('Loading skills…'));
    const footer = note('Make a skill by asking Brain² to “create a skill”, or in ClickUp.');
    el.pop.append(filter, list, footer);
    filter.focus();
    if (!ws) return list.replaceChildren(note('Pick a workspace on the New task tab first.'));
    let skills = [];
    const show = () => {
      const q = filter.value.trim().toLowerCase();
      const shown = skills.filter((s) => !q || s.name.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q));
      list.replaceChildren(
        ...(draft.skill ? [row({ iconName: 'x', name: `Remove ${draft.skill.name}`, onClick: () => (setDraft({ skill: null }), closePop()) })] : []),
        ...(shown.length
          ? shown.map((s) =>
              row({
                iconName: 'slash',
                name: s.name,
                sub: s.summary,
                after: draft.skill?.id === s.id ? svg('check', 14) : null,
                onClick: () => {
                  setDraft({ skill: { id: s.id, name: s.name } });
                  closePop();
                  el.input.focus();
                },
              }),
            )
          : [note(skills.length ? 'No skill matches.' : 'No skills in this workspace yet.')]),
      );
    };
    filter.addEventListener('input', show);
    skillsFor(ws).then(
      (s) => {
        skills = s;
        if (pop === 'skills') show();
      },
      (err) => {
        if (pop === 'skills') list.replaceChildren(note(`Couldn't load skills: ${err?.message || err}`));
      },
    );
  }

  function buildModel() {
    const ws = currentWorkspace();
    const list = h('div', { className: 'brain-results' }, note('Loading models…'));
    el.pop.append(heading('Model'), list);
    const show = (models) => {
      const rows = [];
      for (const m of models) {
        const selected = m.id === model.id;
        const badges = [
          m.badge ? h('span', { className: 'badge-new', textContent: m.badge }) : null,
          m.premium ? h('span', { className: 'badge-premium', textContent: 'Premium' }) : null,
          selected ? svg('check', 14) : null,
        ];
        rows.push(
          row({
            logo: m.id === 'auto',
            color: m.id === 'auto' ? undefined : '',
            name: m.name,
            sub: m.description,
            after: badges,
            disabled: !m.canUse,
            onClick: () => {
              if (m.id !== model.id) chooseModel({ id: m.id, name: m.name, reasoning: '' });
              show(models);
            },
          }),
        );
        if (selected && m.reasoning.length) {
          const seg = h('div', { className: 'brain-effort', role: 'group', ariaLabel: 'Thinking effort' });
          for (const level of [{ key: '', label: 'Auto' }, ...m.reasoning]) {
            const b = h('button', { type: 'button', textContent: level.label });
            b.setAttribute('aria-pressed', String(model.reasoning === level.key));
            b.addEventListener('click', () => {
              chooseModel({ ...model, reasoning: level.key });
              show(models);
            });
            seg.append(b);
          }
          rows.push(seg);
        }
      }
      list.replaceChildren(...rows);
    };
    if (!ws) return show([{ ...BRAIN, description: '', badge: '', premium: false, canUse: true, reasoning: [] }]);
    modelsFor(ws).then(
      (models) => pop === 'model' && show(models.length ? models : [{ ...BRAIN, description: '', badge: '', premium: false, canUse: true, reasoning: [] }]),
      (err) => {
        if (pop !== 'model') return;
        show([{ ...BRAIN, description: 'ClickUp’s default', badge: '', premium: false, canUse: true, reasoning: [] }]);
        list.append(note(`Couldn't load the other models: ${err?.message || err}`));
      },
    );
  }

  function chooseModel(next) {
    model = { id: next.id, name: next.name, reasoning: next.reasoning || '' };
    renderBar();
    getPrefs()
      .then((prefs) => setPrefs({ brain: { ...prefs.brain, model: model.id, modelName: model.name, reasoning: model.reasoning } }))
      .catch(console.error);
  }

  // --- files ----------------------------------------------------------------------------------

  /** Brain²'s file rules from the model list when it's loaded, else the built-in ones. */
  function fileRules() {
    return lastBrainRules || DEFAULT_FILE_RULES;
  }
  let lastBrainRules = null;

  function addFiles(files) {
    const added = [];
    for (const file of files) {
      const rule = brainFileRule(file, fileRules());
      const entry = { key: ++fileSeq, file, name: file.name, status: rule.ok ? 'uploading' : 'failed', progress: 0, error: rule.ok ? '' : rule.reason };
      added.push(entry);
    }
    if (!added.length) return;
    setDraft({ files: [...draft.files, ...added] });
    for (const entry of added) if (entry.status === 'uploading') upload(entry);
  }

  async function upload(entry) {
    const ws = currentWorkspace();
    if (!ws) {
      entry.status = 'failed';
      entry.error = 'Pick a workspace on the New task tab first.';
      return setDraft({});
    }
    entry.ctl = new AbortController();
    try {
      entry.att = await withSession(ws, async (session) =>
        uploadForBrain({
          session,
          roomId: await roomFor(session, entry.ctl.signal),
          file: entry.file,
          signal: entry.ctl.signal,
          onProgress: (p) => {
            entry.progress = p;
            renderChips();
          },
        }),
      );
      entry.status = 'done';
    } catch (err) {
      if (err?.name === 'AbortError') return;
      entry.status = 'failed';
      entry.error = err?.message || 'Upload failed.';
    }
    setDraft({});
  }

  // --- messages -------------------------------------------------------------------------------

  function scrollToEnd() {
    el.log.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }

  function addUserMessage(text, sent) {
    const li = h('li', { className: 'brain-msg user' });
    const chips = draftChips(sent, false);
    if (chips.length) li.append(h('div', { className: 'brain-chips' }, chips));
    li.append(h('p', { textContent: text }));
    el.log.append(li);
    el.intro.hidden = true;
    scrollToEnd();
    return li;
  }

  function addBrainMessage(modelName) {
    const by = h('div', { className: 'brain-by' }, h('span', { className: 'brain-mark', innerHTML: brainLogo(18) }), modelName === BRAIN.name ? 'Brain²' : `Brain² · ${modelName}`);
    const li = h('li', { className: 'brain-msg brain' }, by, h('div', { className: 'brain-progress', textContent: 'Thinking…' }));
    el.log.append(li);
    scrollToEnd();
    return li;
  }

  function setProgress(li, text) {
    const p = li.querySelector('.brain-progress');
    if (p) p.textContent = text;
  }

  /** The answer as it is being written (Markdown text, shown as plain text until the final version). */
  function setLive(li, text) {
    let live = li.querySelector('.brain-live');
    if (!live) {
      live = h('div', { className: 'brain-live' });
      li.querySelector('.brain-progress')?.after(live);
    }
    live.textContent = text;
    scrollToEnd();
  }

  function setFinal(li, reply, workspaceId) {
    li.querySelector('.brain-progress')?.remove();
    li.querySelector('.brain-live')?.remove();
    const body = reply.ops.length ? renderOps(reply.ops, document, { workspaceId }) : null;
    if (body?.childNodes.length) {
      body.className = 'brain-body';
      li.append(body);
      decorateMentions(body);
    } else {
      li.append(h('div', { className: 'brain-body' }, h('p', { textContent: reply.text || '(No answer)' })));
    }
    const copy = h('button', { type: 'button', className: 'brain-icon-btn', title: 'Copy', ariaLabel: 'Copy answer', innerHTML: icon('copy', 15) });
    copy.addEventListener('click', () => {
      navigator.clipboard.writeText(reply.text || li.querySelector('.brain-body')?.innerText || '').then(
        () => {
          copy.innerHTML = icon('check', 15);
          setTimeout(() => (copy.innerHTML = icon('copy', 15)), 1500);
        },
        () => {},
      );
    });
    li.append(h('div', { className: 'brain-tools' }, copy));
  }

  /** Task mentions become chips with the task's name and status colour. */
  function decorateMentions(body) {
    for (const a of body.querySelectorAll('a.mention')) {
      const label = h('span', { className: 'label', textContent: a.textContent });
      a.replaceChildren(h('span', { className: 'dot' }), label);
      const id = a.getAttribute('data-task-id');
      if (!id) continue;
      lookupTask(id).then((info) => {
        if (!info) return;
        label.textContent = info.name;
        a.title = info.name;
        if (info.color) a.firstChild.style.setProperty('--chip-color', info.color);
      });
    }
  }

  function setFailed(li, message) {
    li.className = 'brain-msg brain failed';
    li.querySelector('.brain-progress')?.remove();
    li.querySelector('.brain-live')?.remove();
    li.append(h('p', { className: 'brain-text', textContent: message }));
  }

  // --- asking ---------------------------------------------------------------------------------

  async function ask() {
    const text = el.input.value.trim();
    if (!text || inflight || draft.files.some((f) => f.status === 'uploading')) return;
    closePop();
    const workspaceId = currentWorkspace();
    if (!workspaceId) {
      setFailed(addBrainMessage(model.name), 'Pick a workspace on the New task tab first.');
      return;
    }
    const sent = { ...draft, files: draft.files.filter((f) => f.status === 'done') };
    const asked = { ...model };
    const userLi = addUserMessage(text, sent);
    const replyLi = addBrainMessage(asked.name);
    el.input.value = '';
    autosize();
    draft = { items: [], files: [], skill: null, deepResearch: false };
    renderChips();
    inflight = new AbortController();
    const { signal } = inflight;
    const live = new AbortController();
    signal.addEventListener('abort', () => live.abort(), { once: true });
    renderBar();

    const gen = generation;
    const current = () => gen === generation; // false once New chat replaced this conversation
    let posted = false;
    let ids = { roomId: chat.roomId, threadId: chat.threadId, invokeId: null };
    const attachments = sent.files.map((f) => f.att);
    try {
      const reply = await withSession(workspaceId, async (session) => {
        if (!posted) {
          const roomId = ids.roomId || (await roomFor(session, signal));
          const invokeId = await postQuestion(
            session,
            {
              roomId,
              threadId: ids.threadId,
              text,
              model: asked.id,
              reasoning: asked.reasoning,
              deepResearch: sent.deepResearch,
              items: sent.items.map((i) => ({ kind: i.kind, id: i.id })),
              attachments,
              skill: sent.skill,
            },
            { signal },
          );
          posted = true;
          ids = { roomId, threadId: ids.threadId || invokeId, invokeId };
          if (current()) chat = { ...chat, workspaceId, roomId, threadId: ids.threadId };
        }
        const triggers = questionTriggers(ids.invokeId, attachments.map((a) => a.id));
        // The answer as it's written, when the live connection works; the thread poll is the fallback
        // and brings the formatted version.
        watchAnswer(socketFor(workspaceId), { roomId: ids.roomId, invokeId: ids.invokeId, triggers, signal: live.signal, onText: (t) => current() && setLive(replyLi, t) }).catch(() => {});
        return waitForReply(session, {
          threadId: ids.threadId,
          invokeId: ids.invokeId,
          triggers,
          signal,
          onProgress: (step) => setProgress(replyLi, step),
        });
      });
      live.abort();
      if (!current()) return;
      setFinal(replyLi, reply, workspaceId);
      if (reply.conversationId) {
        chat.conversationId = reply.conversationId;
        el.open.href = conversationUrl(workspaceId, reply.conversationId);
        el.open.hidden = false;
      }
    } catch (err) {
      live.abort();
      if (!current()) return; // its messages are gone with the old chat
      if (!posted) {
        // Nothing reached ClickUp: take the question back off the screen, with its chips.
        userLi.remove();
        el.input.value = text;
        draft = { ...sent, files: [...sent.files, ...draft.files] };
        renderChips();
      }
      if (err?.name === 'AbortError') {
        if (posted) setFailed(replyLi, 'Stopped waiting. Brain² may still answer this in ClickUp.');
        else replyLi.remove();
        if (!el.log.children.length) el.intro.hidden = false;
      } else {
        setFailed(replyLi, err?.message || 'ClickUp Brain² could not answer.');
        if (!(err?.status >= 400) && !err?.code) console.warn('[brain]', err);
      }
    } finally {
      inflight = null;
      renderBar();
      renderWhere();
      scrollToEnd();
      if (!el.input.disabled) el.input.focus();
    }
  }

  function reset() {
    generation++;
    inflight?.abort();
    for (const f of draft.files) f.ctl?.abort();
    closePop();
    chat = { workspaceId: null, roomId: null, threadId: null, conversationId: null };
    draft = { items: [], files: [], skill: null, deepResearch: false };
    el.log.textContent = '';
    el.intro.hidden = false;
    el.open.hidden = true;
    el.input.value = '';
    autosize();
    renderChips();
    renderBar();
    renderWhere();
    el.input.focus();
  }

  function autosize() {
    el.input.style.height = 'auto';
    el.input.style.height = `${el.input.scrollHeight}px`;
  }

  // --- wiring ---------------------------------------------------------------------------------

  el.send.addEventListener('click', () => (inflight ? inflight.abort() : ask()));
  el.reset.addEventListener('click', reset);
  el.plus.addEventListener('click', () => openPop('plus'));
  el.skills.addEventListener('click', () => openPop('skills'));
  el.model.addEventListener('click', () => openPop('model'));
  el.research.addEventListener('click', () => setDraft({ deepResearch: false }));
  el.file.addEventListener('change', () => {
    addFiles([...el.file.files]);
    el.file.value = '';
  });
  el.input.addEventListener('input', () => {
    autosize();
    renderBar();
  });
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      ask();
    } else if (e.key === '/' && !el.input.value) {
      // Like ClickUp: "/" at the start picks a skill.
      e.preventDefault();
      openPop('skills');
    }
  });
  el.composer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pop) {
      e.stopPropagation();
      closePop();
      el.input.focus();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (pop && !el.composer.contains(e.target)) closePop();
  });

  getPrefs()
    .then((prefs) => {
      const saved = prefs.brain;
      if (saved?.model && saved.model !== 'auto') model = { id: saved.model, name: saved.modelName || saved.model, reasoning: saved.reasoning || '' };
      else if (saved?.reasoning) model = { ...BRAIN, reasoning: saved.reasoning };
      renderBar();
    })
    .catch(() => {});
  renderChips();
  renderBar();

  return {
    /** The task found on the Existing tab ({ id, name, teamId }), or null. Offered as a chip, never added by itself. */
    setTask(next) {
      suggested = next ? { ...next } : null;
      renderChips();
    },
    /** Files dropped or pasted on the panel while the Brain² tab is open. */
    addFiles,
    /** Workspace list or selection changed. */
    refresh: renderWhere,
    focus() {
      if (!el.input.disabled) el.input.focus();
    },
  };
}
