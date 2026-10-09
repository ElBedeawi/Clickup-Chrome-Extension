import * as api from '../lib/clickup-api.js';
import { getToken, getPrefs, setPrefs, onTokenChanged } from '../lib/storage.js';
import { listAttachments, deleteAttachment } from '../lib/attachments-db.js';
import { captureScreenshot, openEditor } from '../lib/screenshot.js';
import { createCaptureSession, recoverInterruptedRecording } from '../lib/capture-session.js';
import { isSidebar, canRecordTab, browserName, keepPanelOpenHint } from '../lib/platform.js';
import { createDetails } from './details.js';
import { createRecorderCard } from './recorder-card.js';
import { createActionMenu } from './menu.js';
import { icon, hydrateIcons } from '../lib/icons.js';
import { hydrateLinks } from '../lib/links.js';

const $ = (id) => document.getElementById(id);

const el = {
  noToken: $('no-token'),
  app: $('app'),
  formArea: $('form-area'),
  taskFields: $('task-fields'),
  tabs: document.querySelectorAll('.tab'),
  panelNew: $('panel-new'),
  panelExisting: $('panel-existing'),
  targetBanner: $('target-banner'),

  workspace: $('sel-workspace'),
  space: $('sel-space'),
  folder: $('sel-folder'),
  list: $('sel-list'),
  title: $('task-title'),
  desc: $('task-desc'),
  status: $('sel-status'),
  priority: $('sel-priority'),

  taskRef: $('task-ref'),
  taskCheck: $('task-check'),
  taskRefHint: $('task-ref-hint'),
  taskFound: $('task-found'),

  toolRecord: $('tool-record'),
  recordCard: $('record-card'),
  btnRecord: $('btn-record'),
  recordHint: $('record-hint'),
  recNote: $('rec-note'),
  commentDetails: $('comment-details'),
  commentText: $('comment-text'),
  recording: $('recording'),
  recTime: $('rec-time'),
  btnStop: $('btn-stop'),
  micNotice: $('mic-notice'),
  btnGrantMic: $('btn-grant-mic'),
  btnAddFiles: $('btn-add-files'),
  fileInput: $('file-input'),
  attachmentList: $('attachment-list'),

  error: $('error'),
  submit: $('btn-submit'),

  success: $('success'),
  successTitle: $('success-title'),
  successLink: $('success-link'),
  successDetail: $('success-detail'),
  successAgain: $('success-again'),
};

const state = {
  mode: 'new', // 'new' | 'existing'
  busy: false,
  /** Folders of the selected space, keyed by id — each includes its `lists`. */
  folders: new Map(),
  /** Task the attachments go to once known: { id, url, name, customTaskIds, teamId } */
  target: null,
  /** Existing-task ref auto-filled from the active tab (so we don't overwrite manual input). */
  autoRef: '',
  /**
   * `dbId` is set for recordings, which are also kept in IndexedDB until uploaded or removed.
   * @type {{ id: number, file: File, url: string, dbId?: number, status: 'pending'|'uploading'|'done'|'failed', progress: number, error?: string }[]}
   */
  attachments: [],
  /** Mirrors chrome.storage.session `recording`: { startedAt } while the offscreen recorder runs. */
  recording: null,
  /** Existing-task comment: posted once per submit, even across retries. */
  commentPosted: false,
  commentError: false,
};

let nextAttachmentId = 1;
let recTimer = null;

const details = createDetails({ getListId: () => el.list.value, getSpaceId: () => el.space.value });

hydrateIcons();
hydrateLinks();

// Side panels can't show the mic permission prompt; a normal extension tab can,
// and the grant then applies to the whole extension origin (incl. the recorder's page).
function openMicGrant() {
  chrome.tabs.create({ url: chrome.runtime.getURL('permissions/microphone.html') });
}

const recorderCard = await createRecorderCard({ onGrantMic: openMicGrant });

// ---------------------------------------------------------------------------
// Generic UI helpers
// ---------------------------------------------------------------------------

function showError(message) {
  el.error.textContent = message;
  el.error.hidden = !message;
  if (message) el.error.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * @param {HTMLSelectElement} select
 * @param {{ id: string, name: string }[]} items
 * @param {{ placeholder?: string, value?: string }} opts
 */
function fillSelect(select, items, { placeholder, value } = {}) {
  select.replaceChildren();
  if (placeholder !== undefined) select.add(new Option(placeholder, ''));
  for (const item of items) select.add(new Option(item.name, String(item.id)));
  if (value != null && items.some((i) => String(i.id) === String(value))) select.value = String(value);
  select.disabled = false;
}

function resetSelect(select, label = '') {
  select.replaceChildren(new Option(label, ''));
  select.disabled = true;
}

// ---------------------------------------------------------------------------
// Token gate
// ---------------------------------------------------------------------------

async function applyToken(token) {
  el.noToken.hidden = !!token;
  el.app.hidden = !token;
  if (token) await loadWorkspaces();
}

// ---------------------------------------------------------------------------
// Hierarchy cascade: Workspace → Space → Folder → List → Status
//
// Every level remembers its last pick per parent (prefs.last), so the panel opens on
// the last-used list, and switching to another workspace/space/folder jumps straight
// to whatever you last used there.
// ---------------------------------------------------------------------------

const memoryKey = {
  workspace: () => 'workspace',
  space: () => `space:${el.workspace.value}`,
  folder: () => `folder:${el.space.value}`,
  list: () => `list:${el.space.value}/${el.folder.value}`,
};

async function recall(level) {
  const { last = {} } = await getPrefs();
  return last[memoryKey[level]()];
}

async function remember(level, value) {
  const { last = {} } = await getPrefs();
  await setPrefs({ last: { ...last, [memoryKey[level]()]: value } });
}

async function loadWorkspaces() {
  resetSelect(el.workspace, 'Loading…');
  [el.space, el.folder, el.list, el.status].forEach((s) => resetSelect(s));
  try {
    const [teams, value] = await Promise.all([api.getWorkspaces(), recall('workspace')]);
    fillSelect(el.workspace, teams, {
      placeholder: teams.length === 1 ? undefined : 'Select workspace',
      value,
    });
    if (el.workspace.value) await loadSpaces();
  } catch (err) {
    resetSelect(el.workspace, 'Failed to load');
    showError(err.message);
  }
}

async function loadSpaces() {
  const teamId = el.workspace.value;
  [el.folder, el.list, el.status].forEach((s) => resetSelect(s));
  details.reload();
  if (!teamId) return resetSelect(el.space);
  resetSelect(el.space, 'Loading…');
  try {
    const [spaces, value] = await Promise.all([api.getSpaces(teamId), recall('space')]);
    if (el.workspace.value !== teamId) return; // selection changed while loading
    fillSelect(el.space, spaces, {
      placeholder: spaces.length === 1 ? undefined : 'Select space',
      value,
    });
    if (el.space.value) await loadFolders();
  } catch (err) {
    resetSelect(el.space, 'Failed to load');
    showError(err.message);
  }
}

async function loadFolders() {
  const spaceId = el.space.value;
  [el.list, el.status].forEach((s) => resetSelect(s));
  details.reload();
  state.folders.clear();
  if (!spaceId) return resetSelect(el.folder);
  resetSelect(el.folder, 'Loading…');
  try {
    const [folders, value] = await Promise.all([api.getFolders(spaceId), recall('folder')]);
    if (el.space.value !== spaceId) return;
    folders.forEach((f) => state.folders.set(String(f.id), f));
    // "" = lists that live directly in the space (no folder)
    fillSelect(el.folder, folders, { placeholder: '— No folder —', value });
    await loadLists();
  } catch (err) {
    resetSelect(el.folder, 'Failed to load');
    showError(err.message);
  }
}

async function loadLists() {
  const spaceId = el.space.value;
  const folderId = el.folder.value;
  resetSelect(el.status);
  resetSelect(el.list, 'Loading…');
  try {
    // Folder responses already include their lists; folderless lists need their own call.
    const [lists, value] = await Promise.all([
      folderId
        ? state.folders.get(folderId)?.lists ?? api.getLists(folderId)
        : api.getFolderlessLists(spaceId),
      recall('list'),
    ]);
    if (el.space.value !== spaceId || el.folder.value !== folderId) return;
    fillSelect(el.list, lists, {
      placeholder: lists.length === 1 ? undefined : lists.length ? 'Select list' : 'No lists here',
      value,
    });
    details.reload();
    if (el.list.value) await loadStatuses();
  } catch (err) {
    resetSelect(el.list, 'Failed to load');
    showError(err.message);
  }
}

async function loadStatuses() {
  const listId = el.list.value;
  if (!listId) return resetSelect(el.status);
  resetSelect(el.status, 'Loading…');
  try {
    const list = await api.getList(listId);
    if (el.list.value !== listId) return;
    const statuses = (list.statuses || []).map((s) => ({ id: s.status, name: s.status }));
    fillSelect(el.status, statuses, { placeholder: 'Default' });
  } catch (err) {
    resetSelect(el.status, 'Default');
    el.status.disabled = false;
  }
}

// Save before loading the next level so prefs writes never interleave.
el.workspace.addEventListener('change', async () => {
  await remember('workspace', el.workspace.value);
  loadSpaces();
});
el.space.addEventListener('change', async () => {
  await remember('space', el.space.value);
  loadFolders();
});
el.folder.addEventListener('change', async () => {
  await remember('folder', el.folder.value);
  loadLists();
});
el.list.addEventListener('change', async () => {
  await remember('list', el.list.value);
  details.reload();
  loadStatuses();
});

// ---------------------------------------------------------------------------
// Mode tabs
// ---------------------------------------------------------------------------

function setMode(mode) {
  state.mode = mode;
  el.tabs.forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  el.panelNew.hidden = mode !== 'new';
  el.panelExisting.hidden = mode !== 'existing';
  showError('');
  render();
}

el.tabs.forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

// ---------------------------------------------------------------------------
// Existing task: detect from active tab, validate
// ---------------------------------------------------------------------------

function refFromInput() {
  const ref = api.parseTaskRef(el.taskRef.value);
  // Custom IDs (DEV-123) need the workspace id; fall back to the selected workspace.
  if (ref?.customTaskIds && !ref.teamId) ref.teamId = el.workspace.value || undefined;
  return ref;
}

async function checkExistingTask() {
  el.taskFound.hidden = true;
  const ref = refFromInput();
  if (!ref) {
    el.taskRefHint.textContent = 'Enter a ClickUp task URL or ID.';
    return null;
  }
  el.taskCheck.disabled = true;
  try {
    const task = await api.getTask(ref.taskId, ref);
    el.taskFound.textContent = `✓ ${task.name}`;
    el.taskFound.hidden = false;
    showError('');
    return { id: task.id, url: task.url, name: task.name, customTaskIds: false };
  } catch (err) {
    showError(err.status === 404 || err.status === 400 ? `Task not found: ${err.message}` : err.message);
    return null;
  } finally {
    el.taskCheck.disabled = false;
  }
}

async function detectTaskFromActiveTab() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return;
  }
  // Our own pages (e.g. the screenshot editor) shouldn't clear a detected task.
  if (tab?.url?.startsWith(chrome.runtime.getURL(''))) return;
  const ref = tab?.url ? api.parseTaskRef(tab.url) : null;
  const current = el.taskRef.value.trim();
  // Only touch the field if it's empty or still holds a previous auto-fill.
  if (current && current !== state.autoRef) return;

  if (ref) {
    el.taskRef.value = tab.url;
    state.autoRef = tab.url;
    el.taskRefHint.textContent = 'Detected from the current tab.';
    if (state.mode === 'existing') checkExistingTask();
  } else if (current === state.autoRef) {
    el.taskRef.value = '';
    state.autoRef = '';
    el.taskRefHint.textContent = '';
    el.taskFound.hidden = true;
  }
}

el.taskCheck.addEventListener('click', checkExistingTask);
el.taskRef.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') checkExistingTask();
});
el.taskRef.addEventListener('input', () => {
  el.taskFound.hidden = true;
  el.taskRefHint.textContent = '';
});

chrome.tabs.onActivated.addListener(detectTaskFromActiveTab);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) detectTaskFromActiveTab();
});

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

function addFiles(files) {
  for (const file of files) {
    state.attachments.push({
      id: nextAttachmentId++,
      file,
      url: URL.createObjectURL(file),
      status: 'pending',
      progress: 0,
    });
  }
  render();
}

function forgetPending(a) {
  if (a.dbId) deleteAttachment(a.dbId).catch(console.error);
}

function removeAttachment(id) {
  const index = state.attachments.findIndex((a) => a.id === id);
  if (index === -1) return;
  const [a] = state.attachments.splice(index, 1);
  URL.revokeObjectURL(a.url);
  forgetPending(a);
  render();
}

function clearAttachments() {
  state.attachments.forEach((a) => {
    URL.revokeObjectURL(a.url);
    forgetPending(a);
  });
  state.attachments = [];
}

function renderAttachments() {
  el.attachmentList.replaceChildren(
    ...state.attachments.map((a) => {
      const li = document.createElement('li');
      li.className = 'attachment';
      li.dataset.id = String(a.id);

      const meta = document.createElement('div');
      meta.className = 'meta';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = a.file.name;
      name.title = a.file.name;
      const size = document.createElement('span');
      size.className = 'size';
      size.textContent = formatBytes(a.file.size);
      const remove = document.createElement('button');
      remove.className = 'remove';
      remove.textContent = '✕';
      remove.title = 'Remove';
      remove.disabled = state.busy || a.status === 'done';
      remove.addEventListener('click', () => removeAttachment(a.id));
      meta.append(name, size, remove);
      li.append(meta);

      if (a.file.type.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = a.url;
        video.controls = true;
        video.preload = 'metadata';
        li.append(video);
      } else if (a.file.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = a.url;
        img.alt = a.file.name;
        li.append(img);
      }

      if (a.status === 'uploading') {
        const bar = document.createElement('div');
        bar.className = 'progress';
        const fill = document.createElement('div');
        fill.style.width = `${Math.round(a.progress * 100)}%`;
        bar.append(fill);
        li.append(bar);
      } else if (a.status === 'done' || a.status === 'failed') {
        const s = document.createElement('div');
        s.className = `state ${a.status}`;
        s.textContent = a.status === 'done' ? '✓ Uploaded' : `✕ ${a.error || 'Upload failed'}`;
        li.append(s);
      }
      return li;
    }),
  );
}

/** Updates just the progress bar, without re-rendering (keeps video previews from reloading). */
function updateProgress(a) {
  const fill = el.attachmentList.querySelector(`[data-id="${a.id}"] .progress > div`);
  if (fill) fill.style.width = `${Math.round(a.progress * 100)}%`;
}

el.btnAddFiles.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => {
  addFiles(el.fileInput.files);
  el.fileInput.value = '';
});

// Drop files anywhere in the panel.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.classList.add('dragging');
});
document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove('dragging');
});
document.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  if (e.dataTransfer?.files.length && !state.busy) addFiles(e.dataTransfer.files);
});

// Paste screenshots anywhere in the panel. Text pastes into inputs are left alone.
document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length || state.busy) return;
  e.preventDefault();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  addFiles(
    files.map((f, i) =>
      f.name && f.name !== 'image.png'
        ? f
        : new File([f], `pasted-${stamp}${files.length > 1 ? `-${i + 1}` : ''}.png`, { type: f.type }),
    ),
  );
});

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

// Where the recorder lives depends on the browser (lib/platform.js):
//   Chrome  — in an offscreen document driven by background.js, so recording continues while
//             this panel is closed. The panel only mirrors the state (chrome.storage.session)
//             and picks up finished recordings from IndexedDB.
//   Firefox — no offscreen documents, so this sidebar page hosts the recorder itself. The
//             background still owns the state + REC badge; we report changes with `rec:state`.
//             Closing the sidebar kills the recorder; its chunks are recovered on the next open.
// Either way `host` answers { ok, micError? } / { ok, draftId } or { ok:false, name, error }.

function sendToBackground(msg) {
  return chrome.runtime.sendMessage({ target: 'background', ...msg });
}

const backgroundHost = {
  start: (options) => sendToBackground({ type: 'rec:start', ...options }),
  stop: () => sendToBackground({ type: 'rec:stop' }),
  screenshot: () => sendToBackground({ type: 'shot:screen' }),
};

function createLocalHost() {
  const session = createCaptureSession({
    // The user ended sharing from the browser's own indicator.
    onFinished: ({ error }) => sendToBackground({ type: 'rec:state', recording: null, error }),
  });
  const failure = (err) => ({ ok: false, name: err?.name, error: err?.message ?? String(err ?? 'unknown error') });

  // Sidebars in other windows ask "is anyone recording?" before recovering chunks from disk.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.target !== 'host') return false;
    const result = session.handle(msg);
    if (!result) return false; // not recording: leave the channel to a sidebar that is
    result.then(sendResponse, (err) => sendResponse(failure(err)));
    return true;
  });

  // Closing the sidebar mid-recording kills the recorder. Best effort: clear the badge now;
  // the chunks written so far are picked up by recoverInterruptedRecording on the next open.
  window.addEventListener('pagehide', () => {
    if (!session.isRecording()) return;
    sendToBackground({
      type: 'rec:state',
      recording: null,
      error: 'Recording stopped because the sidebar was closed. The part recorded so far was kept.',
    }).catch(() => {});
  });

  return {
    async start(options) {
      // getDisplayMedia needs the click's transient activation, so nothing slow may run before
      // it: read the state directly instead of asking the (possibly asleep) background.
      const { recording } = await chrome.storage.session.get('recording');
      if (recording) return { ok: false, error: 'Already recording.' };
      let res;
      try {
        res = await session.start(options);
      } catch (err) {
        return failure(err);
      }
      await sendToBackground({ type: 'rec:state', recording: { startedAt: Date.now() } });
      return res;
    },
    async stop() {
      if (!session.isRecording()) {
        // The recorder lives in another window's sidebar (or died with one): ask it to stop,
        // then clear the shared state either way.
        const res = await chrome.runtime.sendMessage({ target: 'host', type: 'rec:stop' }).catch(() => null);
        await sendToBackground({ type: 'rec:state', recording: null });
        return res ?? { ok: true };
      }
      try {
        return await session.stop();
      } catch (err) {
        return failure(err);
      } finally {
        await sendToBackground({ type: 'rec:state', recording: null });
      }
    },
    screenshot: () => session.screenshot().catch(failure),
  };
}

const host = isSidebar() ? createLocalHost() : backgroundHost;
if (isSidebar()) el.recNote.textContent = keepPanelOpenHint();

/** Firefox: a sidebar closed mid-recording leaves its chunks on disk — turn them into an attachment. */
async function recoverAfterSidebarClosed() {
  try {
    const file = await recoverInterruptedRecording({
      hostAlive: async () => {
        try {
          return !!(await chrome.runtime.sendMessage({ target: 'host', type: 'rec:ping' }))?.recording;
        } catch {
          return false;
        }
      },
    });
    if (!file) return;
    await sendToBackground({ type: 'rec:state', recording: null });
    el.recordHint.textContent = 'The recording was cut short when the sidebar closed; the part recorded so far was kept.';
  } catch (err) {
    console.error('Recovering the interrupted recording failed', err);
  }
}

const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Adds saved recordings/screenshots that aren't in the attachment list yet. */
async function syncPending() {
  let records;
  try {
    records = await listAttachments();
  } catch (err) {
    showError(`Could not load saved attachments: ${err.message}`);
    return;
  }
  const known = new Set(state.attachments.map((a) => a.dbId).filter(Boolean));
  for (const record of records) {
    if (record.draft) {
      // Still open in the screenshot editor — or an editor tab closed without attaching.
      if (Date.now() - record.createdAt > DRAFT_MAX_AGE_MS) deleteAttachment(record.id).catch(console.error);
      continue;
    }
    if (known.has(record.id)) continue;
    state.attachments.push({
      id: nextAttachmentId++,
      file: record.file,
      url: URL.createObjectURL(record.file),
      dbId: record.id,
      status: 'pending',
      progress: 0,
    });
  }
  render();
}

function applyRecordingState(recording) {
  state.recording = recording || null;
  clearInterval(recTimer);
  el.toolRecord.disabled = !!state.recording;
  if (state.recording) setRecordCardOpen(false);
  el.recording.hidden = !state.recording;
  if (state.recording) {
    const tick = () => {
      el.recTime.textContent = formatDuration(Date.now() - state.recording.startedAt);
    };
    tick();
    recTimer = setInterval(tick, 500);
  }
  render();
}

chrome.storage.session.onChanged.addListener((changes) => {
  if ('recording' in changes) {
    const wasRecording = !!state.recording;
    applyRecordingState(changes.recording.newValue);
    if (wasRecording && !state.recording) syncPending();
  }
  if (changes.recordingError?.newValue) showError(changes.recordingError.newValue);
  if ('attachmentsChangedAt' in changes) syncPending();
});

el.btnRecord.addEventListener('click', async () => {
  showError('');
  el.micNotice.hidden = true;
  el.btnRecord.disabled = true;
  el.recordHint.textContent = `Choose what to share in ${browserName()}’s picker…`;
  recorderCard.releaseMic(); // the level meter holds the mic; the recorder needs it
  try {
    const res = await host.start(recorderCard.options());
    el.recordHint.textContent = '';
    if (res?.ok) {
      if (res.micError) el.micNotice.hidden = false;
    } else if (res?.name === 'NotAllowedError') {
      // The user cancelled the screen picker.
      el.recordHint.textContent = 'Recording cancelled.';
      recorderCard.setActive(!el.recordCard.hidden);
    } else {
      showError(`Could not start recording: ${res?.error || 'unknown error'}`);
    }
  } catch (err) {
    el.recordHint.textContent = '';
    showError(`Could not start recording: ${err.message}`);
  } finally {
    el.btnRecord.disabled = false;
  }
});

el.btnStop.addEventListener('click', async () => {
  el.btnStop.disabled = true;
  try {
    const res = await host.stop();
    if (!res?.ok) showError(`Recording stopped with an error: ${res?.error || 'unknown error'}`);
  } catch (err) {
    showError(err.message);
  } finally {
    el.btnStop.disabled = false;
  }
});

el.btnGrantMic.addEventListener('click', openMicGrant);

// ---------------------------------------------------------------------------
// Screenshots — captured here, annotated in the editor tab, attached via IndexedDB
// ---------------------------------------------------------------------------

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** "Entire screen": the browser's share picker, shown by whichever page hosts the recorder. */
async function captureEntireScreen() {
  const res = await host.screenshot();
  if (!res?.ok) {
    if (res?.name === 'NotAllowedError') return null; // picker cancelled
    throw new Error(res?.error || 'unknown error');
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { draftId: res.draftId, tab };
}

const SURFACES = canRecordTab() ? 'a screen, window or tab' : 'a screen or window';
const HINTS = {
  visible: 'Capturing…',
  area: 'Drag over the page to select an area…',
  screen: `Choose ${SURFACES} in ${browserName()}’s picker…`,
};

async function onScreenshot(mode) {
  showError('');
  shotMenu.setDisabled(true);
  el.recordHint.textContent = HINTS[mode];
  try {
    // Area and screen modes wait for the user, so they get a generous limit; never hang forever.
    const shot = await withTimeout(
      mode === 'screen' ? captureEntireScreen() : captureScreenshot(mode),
      mode === 'visible' ? 15_000 : 5 * 60_000,
      'Screenshot timed out. Reload the page you’re capturing and try again.',
    );
    if (shot) await openEditor(shot.draftId, shot.tab);
  } catch (err) {
    console.error('Screenshot failed', err);
    showError(`Screenshot failed: ${err.message}`);
  } finally {
    el.recordHint.textContent = '';
    shotMenu.setDisabled(false);
  }
}

const shotMenu = createActionMenu($('tool-shot'), {
  label: 'Screenshot',
  buttonClass: 'tool-btn',
  items: [
    { value: 'visible', label: 'Visible tab', icon: 'tab' },
    { value: 'area', label: 'Select area', icon: 'crop' },
    { value: 'screen', label: 'Entire screen', icon: 'monitor', hint: `${SURFACES[0].toUpperCase()}${SURFACES.slice(1)} — ${browserName()} asks which` },
  ],
  trigger: () => {
    const span = document.createElement('span');
    span.className = 'mi';
    span.innerHTML = `${icon('camera')}<span class="tool-label">Screenshot</span>`;
    return span;
  },
  onPick: (item) => onScreenshot(item.value),
});

// ---------------------------------------------------------------------------
// Record clip card
// ---------------------------------------------------------------------------

function setRecordCardOpen(open) {
  el.recordCard.hidden = !open;
  el.toolRecord.setAttribute('aria-expanded', String(open));
  recorderCard.setActive(open);
}

el.toolRecord.addEventListener('click', () => setRecordCardOpen(el.recordCard.hidden));

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

function setBusy(busy) {
  state.busy = busy;
  render();
}

async function uploadPending(target) {
  const queue = state.attachments.filter((a) => a.status !== 'done');
  for (const a of queue) {
    a.status = 'uploading';
    a.progress = 0;
    a.error = undefined;
    renderAttachments();
    try {
      await api.uploadAttachment(target.id, a.file, (p) => {
        a.progress = p;
        updateProgress(a);
      }, target);
      a.status = 'done';
      forgetPending(a);
      a.dbId = undefined;
    } catch (err) {
      a.status = 'failed';
      a.error = err.message;
      // Bad token / out of storage will fail every file the same way — stop early.
      if (err.status === 401 || err.code === 'GBUSED_005') {
        queue.filter((q) => q.status === 'pending').forEach((q) => {
          q.status = 'failed';
          q.error = 'Skipped';
        });
        break;
      }
    }
    renderAttachments();
  }
  return state.attachments.filter((a) => a.status === 'failed').length;
}

async function submit() {
  showError('');
  if (state.recording) return showError('Stop the recording first.');

  const comment = state.mode === 'existing' ? el.commentText.value.trim() : '';

  // Resolve the target task (unless a previous attempt already created / found it).
  let extra;
  if (!state.target) {
    if (state.mode === 'new') {
      if (!el.list.value) return showError('Pick a list for the new task.');
      if (!el.title.value.trim()) {
        el.title.focus();
        return showError('Give the task a title.');
      }
      extra = details.collect();
      if (extra.missing.length) {
        details.open();
        return showError(`Fill in the required field${extra.missing.length > 1 ? 's' : ''}: ${extra.missing.join(', ')}.`);
      }
    } else if (!state.attachments.length && !comment) {
      return showError('Add a file, record a video or write a comment.');
    }
  }

  setBusy(true);
  try {
    if (!state.target) {
      if (state.mode === 'new') {
        const task = await api.createTask(el.list.value, {
          name: el.title.value.trim(),
          markdown_description: el.desc.value.trim(),
          status: el.status.value || undefined,
          priority: el.priority.value ? Number(el.priority.value) : undefined,
          assignees: extra.assignees,
          tags: extra.tags,
          due_date: extra.due_date,
          due_date_time: extra.due_date_time,
          custom_fields: extra.custom_fields,
        });
        state.target = { id: task.id, url: task.url, name: task.name, customTaskIds: false, created: true };
      } else {
        const found = await checkExistingTask();
        if (!found) return;
        state.target = found;
      }
    }

    const failed = await uploadPending(state.target);
    if (failed) {
      showTargetBanner();
      showError(`${failed} file${failed > 1 ? 's' : ''} failed to upload. Fix the issue and press Retry.`);
      return;
    }

    // Comment last, so it lands under the new attachments. Posted once, even across retries.
    if (comment && !state.commentPosted) {
      try {
        await api.createTaskComment(state.target.id, comment, state.target);
        state.commentPosted = true;
      } catch (err) {
        state.commentError = true;
        showTargetBanner();
        showError(`The upload worked, but the comment wasn’t posted: ${err.message}`);
        return;
      }
    }
    state.commentError = false;
    showSuccess(comment && state.commentPosted);
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy(false);
  }
}

function showTargetBanner() {
  const t = state.target;
  el.targetBanner.replaceChildren();
  if (!t) {
    el.targetBanner.hidden = true;
    return;
  }
  const p = document.createElement('p');
  p.append(t.created ? 'Task created: ' : 'Uploading to: ');
  const a = document.createElement('a');
  a.href = t.url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = t.name;
  p.append(a);
  el.targetBanner.append(p);
  el.targetBanner.hidden = false;
}

function showSuccess(commented) {
  const t = state.target;
  const count = state.attachments.length;
  el.successTitle.textContent = t.created ? 'Task created' : count ? 'Uploaded to task' : 'Comment posted';
  el.successLink.href = t.url;
  el.successLink.textContent = `${t.name} ↗`;
  const parts = [count ? `${count} attachment${count > 1 ? 's' : ''} uploaded.` : 'No attachments.'];
  if (commented) parts.push('Comment posted.');
  el.successDetail.textContent = parts.join(' ');
  el.successAgain.textContent = t.created ? 'Create another' : 'Upload more';
  el.success.hidden = false;
  el.formArea.hidden = true;
}

function resetForm() {
  state.target = null;
  state.commentPosted = false;
  state.commentError = false;
  clearAttachments();
  el.title.value = '';
  el.desc.value = '';
  el.priority.value = '';
  if (el.status.options.length) el.status.selectedIndex = 0;
  details.reset();
  el.commentText.value = '';
  el.commentDetails.open = false;
  el.targetBanner.hidden = true;
  el.success.hidden = true;
  el.formArea.hidden = false;
  showError('');
  render();
}

el.submit.addEventListener('click', submit);
el.successAgain.addEventListener('click', resetForm);

// ---------------------------------------------------------------------------
// Render derived UI state
// ---------------------------------------------------------------------------

function render() {
  renderAttachments();

  const recording = !!state.recording;
  const hasFailed = state.attachments.some((a) => a.status === 'failed');

  el.formArea.disabled = state.busy;
  // Once the target task is known, lock the tabs and task fields — edits wouldn't apply anymore.
  el.taskFields.disabled = !!state.target;
  el.submit.disabled = recording;

  if (state.busy) el.submit.textContent = 'Working…';
  else if (hasFailed && state.target) el.submit.textContent = 'Retry failed uploads';
  else if (state.commentError && state.target) el.submit.textContent = 'Retry comment';
  else if (state.mode === 'new') el.submit.textContent = state.attachments.length ? 'Create task & upload' : 'Create task';
  else el.submit.textContent = state.attachments.length ? 'Upload to task' : 'Post comment';
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('no-token-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

onTokenChanged(applyToken);
// Pick up a recording that's still running, or ones finished while the panel was closed.
applyRecordingState((await chrome.storage.session.get('recording')).recording);
if (isSidebar()) await recoverAfterSidebarClosed();
await syncPending();
await applyToken(await getToken());
await detectTaskFromActiveTab();
