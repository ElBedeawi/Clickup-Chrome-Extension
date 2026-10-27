import * as api from '../lib/clickup-api.js';
import { clipsHubUrl, clipsEligible, setClipsPrefs } from '../lib/clickup-clips.js';
import { uploadAsClip as uploadClipViaTab } from './clips-host.js';
import { getToken, getPrefs, setPrefs, onTokenChanged } from '../lib/storage.js';
import { listAttachments, deleteAttachment } from '../lib/attachments-db.js';
import { captureScreenshot, openEditor } from '../lib/screenshot.js';
import { createCaptureSession, recoverInterruptedRecording } from '../lib/capture-session.js';
import { elapsedMs, countdownLeft, recordingPhase } from '../lib/recording-state.js';
import { isSidebar, canRecordTab, browserName, keepPanelOpenHint } from '../lib/platform.js';
import { createDetails } from './details.js';
import { createRecorderCard } from './recorder-card.js';
import { createBubbleStage } from './bubble-stage.js';
import { createActionMenu } from './menu.js';
import { createRichEditor } from './rich-editor.js';
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
  panelClips: $('panel-clips'),
  clipsAutoSave: $('clips-auto-save'),
  targetBanner: $('target-banner'),

  location: $('location'),
  locationPath: $('location-path'),
  locationChange: $('location-change'),
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

  attTitle: $('att-title'),
  attHint: $('att-hint'),
  toolRecord: $('tool-record'),
  toolShot: $('tool-shot'),
  recordCard: $('record-card'),
  btnRecord: $('btn-record'),
  recordHint: $('record-hint'),
  recNote: $('rec-note'),
  commentDetails: $('comment-details'),
  commentText: $('comment-text'),
  recording: $('recording'),
  recLabel: $('rec-label'),
  recTime: $('rec-time'),
  btnPause: $('btn-pause'),
  btnMute: $('btn-mute'),
  btnStop: $('btn-stop'),
  recBubble: $('rec-bubble'),
  micNotice: $('mic-notice'),
  btnGrantMic: $('btn-grant-mic'),
  cameraNotice: $('camera-notice'),
  blurNotice: $('blur-notice'),
  btnGrantCamera: $('btn-grant-camera'),
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
  /** Where the files go (the tabs; remembered in prefs.mode): 'new' | 'existing' | 'clips' */
  mode: 'new',
  /** Clips tab: save a recording to the Clips Hub as soon as it stops (prefs.clips.autoSave). */
  clipsAutoSave: false,
  /**
   * This panel started the running recording, or pressed Stop on one it hosts. Only then does
   * auto-save fire when it ends: recordings recovered or found at boot are never uploaded unasked.
   */
  recordingOwned: false,
  busy: false,
  /** Folders of the selected space, keyed by id — each includes its `lists`. */
  folders: new Map(),
  /** Task the attachments go to once known: { id, url, name, customTaskIds, teamId } */
  target: null,
  /** Existing-task ref auto-filled from the active tab (so we don't overwrite manual input). */
  autoRef: '',
  /**
   * `dbId` is set for recordings, which are also kept in IndexedDB until uploaded or removed
   * (`createdAt` comes from that record). `status` is the task upload; `clip` the Clips Hub one.
   * @type {{ id: number, file: File, url: string, dbId?: number, createdAt?: number, status: 'pending'|'uploading'|'done'|'failed', progress: number, error?: string, clip?: { status: 'uploading'|'done'|'failed', progress?: number|null, hubUrl?: string, error?: string } }[]}
   */
  attachments: [],
  /**
   * Mirrors chrome.storage.session `recording` while the recorder runs:
   * { id, startedAt, camera, mic, pausedAt, pausedMs, micMuted } (see lib/recording-state.js).
   */
  recording: null,
  /** Existing-task comment: posted once per submit, even across retries. */
  commentPosted: false,
  commentError: false,
};

let nextAttachmentId = 1;
let recTimer = null;

const descEditor = createRichEditor(el.desc, {
  placeholder: 'What happened? Steps to reproduce…',
  labelledBy: 'task-desc-label',
});
const details = createDetails({ getListId: () => el.list.value, getSpaceId: () => el.space.value });

hydrateIcons();
hydrateLinks();

// Side panels can't show the mic/camera permission prompt; a normal extension tab can,
// and the grant then applies to the whole extension origin (incl. the recorder's page).
function openGrant(device) {
  chrome.tabs.create({ url: chrome.runtime.getURL(`permissions/microphone.html?device=${device}`) });
}

const recorderCard = await createRecorderCard({
  onGrantMic: () => openGrant('microphone'),
  onGrantCamera: () => openGrant('camera'),
});

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
  renderLocation();
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
  await loadSpaces();
  renderLocation();
});
el.space.addEventListener('change', async () => {
  await remember('space', el.space.value);
  await loadFolders();
  renderLocation();
});
el.folder.addEventListener('change', async () => {
  await remember('folder', el.folder.value);
  await loadLists();
  renderLocation();
});
el.list.addEventListener('change', async () => {
  await remember('list', el.list.value);
  details.reload();
  if (el.list.value) el.location.open = false; // picked: collapse to the summary row
  renderLocation();
  loadStatuses();
});

// ---------------------------------------------------------------------------
// Location row: the four selects live in a <details> whose summary shows the chosen path
// ("Space › Folder › List"). It stays collapsed while a list is selected (most sessions never
// change it) and opens itself whenever there is no list to create the task in.
// ---------------------------------------------------------------------------

const selectedName = (select) => (select.value ? select.options[select.selectedIndex]?.text ?? '' : '');

function renderLocation() {
  const crumbs = [
    el.workspace.options.length > 1 ? selectedName(el.workspace) : '', // one workspace: not worth a crumb
    selectedName(el.space),
    selectedName(el.folder), // "— No folder —" has value "" and is skipped
  ].filter(Boolean);
  const sep = () => Object.assign(document.createElement('span'), { className: 'sep', textContent: ' › ' });
  const nodes = [];
  if (crumbs.length) {
    // Leading crumbs in one span that ellipsizes before the list name does (see .loc-prefix)
    const prefix = Object.assign(document.createElement('span'), { className: 'loc-prefix' });
    crumbs.forEach((name, i) => prefix.append(...(i ? [sep(), name] : [name])));
    nodes.push(prefix, sep());
  }
  const listName = selectedName(el.list);
  nodes.push(
    listName
      ? Object.assign(document.createElement('b'), { textContent: listName })
      : Object.assign(document.createElement('span'), { className: 'muted', textContent: 'Choose a list' }),
  );
  el.locationPath.replaceChildren(...nodes);
  el.locationPath.title = el.locationPath.textContent;
  if (!el.list.value) el.location.open = true;
}

el.location.addEventListener('toggle', () => {
  el.locationChange.textContent = el.location.open ? 'Done' : 'Change';
});

// ---------------------------------------------------------------------------
// Mode tabs
// ---------------------------------------------------------------------------

/** Switches the destination tab. `persist: false` when restoring the remembered one at boot. */
function setMode(mode, { persist = true } = {}) {
  state.mode = mode;
  el.tabs.forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  el.panelNew.hidden = mode !== 'new';
  el.panelExisting.hidden = mode !== 'existing';
  el.panelClips.hidden = mode !== 'clips';

  // The Clips tab is video-only: no screenshots, Attach takes videos, and recording is the
  // main action, so its card is open from the start.
  const clips = mode === 'clips';
  document.body.classList.toggle('clips-mode', clips);
  el.toolShot.hidden = clips;
  el.fileInput.accept = clips ? 'video/*' : '';
  el.btnAddFiles.title = clips ? 'Attach a video' : 'Attach files';
  el.attTitle.textContent = clips ? 'Clips' : 'Attachments';
  el.attHint.textContent = clips ? 'Drop or paste videos anywhere' : 'Drop or paste files anywhere';
  if (clips && !state.recording) setRecordCardOpen(true);

  showError('');
  render();
  if (persist) setPrefs({ mode }).catch(console.error);
}

el.tabs.forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

el.clipsAutoSave.addEventListener('change', () => {
  state.clipsAutoSave = el.clipsAutoSave.checked;
  setClipsPrefs({ autoSave: state.clipsAutoSave }).catch(console.error);
});

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
    return { id: task.id, url: task.url, name: task.name, customTaskIds: false, teamId: task.team_id };
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
  files = [...files];
  if (state.mode === 'clips') {
    // Only videos can become Clips; say so instead of listing a file that would be skipped.
    const refused = files.map((file) => ({ file, ...clipsEligible(file) })).filter((r) => !r.ok);
    if (refused.length) {
      showError(refused.map((r) => `${r.file.name}: ${r.reason}`).join('\n'));
      files = files.filter((file) => clipsEligible(file).ok);
    }
  }
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

/**
 * Shows an attachment full size in a normal tab: the side panel can't go fullscreen (the
 * browser refuses the Fullscreen API there), picture-in-picture is all it gets. Recordings and
 * screenshots are read back from IndexedDB; a file added from disk is opened by its blob URL,
 * which only lives as long as this panel does.
 */
function openInTab(a) {
  const url = a.dbId ? chrome.runtime.getURL(`viewer/viewer.html?id=${a.dbId}`) : a.url;
  chrome.tabs.create({ url }).catch((err) => showError(`Could not open the attachment: ${err.message}`));
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
      const trailing = [];
      if (a.file.type.startsWith('video/') || a.file.type.startsWith('image/')) {
        const open = document.createElement('button');
        open.className = 'open';
        open.innerHTML = icon('external', 14);
        open.title = 'Open in a new tab';
        open.setAttribute('aria-label', 'Open in a new tab');
        open.addEventListener('click', () => openInTab(a));
        trailing.push(open);
      }
      meta.append(name, size, ...trailing, remove);
      li.append(meta);

      if (a.file.type.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = a.url;
        video.controls = true;
        video.preload = 'metadata';
        // The controls' fullscreen button can't work in a side panel: open a tab instead.
        video.addEventListener('fullscreenerror', () => openInTab(a));
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

      // Clips tab: a file added in a task tab that can't be a Clip stays listed, dimmed, and is skipped.
      const eligible = state.mode === 'clips' ? clipsEligible(a.file) : { ok: true };
      if (!eligible.ok) {
        li.classList.add('skipped');
        const s = document.createElement('div');
        s.className = 'state muted';
        s.textContent = `${eligible.reason} Skipped.`;
        li.append(s);
      }

      if (a.clip) li.append(clipStateEl(a));
      return li;
    }),
  );
}

/** Updates just the progress bar, without re-rendering (keeps video previews from reloading). */
function updateProgress(a) {
  const fill = el.attachmentList.querySelector(`[data-id="${a.id}"] .progress > div`);
  if (fill) fill.style.width = `${Math.round(a.progress * 100)}%`;
}

// ---------------------------------------------------------------------------
// Clips tab: "Save to Clips" (see lib/clickup-clips.js and clips-host.js)
// ---------------------------------------------------------------------------

/** The Clip status line under an attachment card. */
function clipStateEl(a) {
  const c = a.clip;
  const box = document.createElement('div');
  box.className = `clip-state ${c.status}`;
  if (c.status === 'uploading') {
    const label = document.createElement('span');
    label.textContent = 'Uploading as Clip…';
    box.append(label);
    if (typeof c.progress === 'number') {
      const bar = document.createElement('div');
      bar.className = 'progress clip-progress';
      const fill = document.createElement('div');
      fill.style.width = `${Math.round(c.progress * 100)}%`;
      bar.append(fill);
      box.append(bar);
    }
  } else if (c.status === 'done') {
    box.append('✓ Saved to Clips · ');
    const link = document.createElement('a');
    link.href = c.hubUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Open Clips Hub ↗';
    box.append(link);
  } else {
    box.textContent = `✕ ${c.error || 'Clip upload failed'}`;
  }
  return box;
}

function updateClipProgress(a) {
  if (typeof a.clip.progress !== 'number') return;
  const card = el.attachmentList.querySelector(`[data-id="${a.id}"]`);
  let fill = card?.querySelector('.clip-progress > div');
  if (!fill) {
    // The card was rendered while the progress was still indeterminate (minting the token): add the bar.
    const box = card?.querySelector('.clip-state.uploading');
    if (!box) return;
    const bar = document.createElement('div');
    bar.className = 'progress clip-progress';
    fill = document.createElement('div');
    bar.append(fill);
    box.append(bar);
  }
  fill.style.width = `${Math.round(a.clip.progress * 100)}%`;
}

/** Attachments the Clips tab would save: eligible videos not yet in the Clips Hub. */
function pendingClips() {
  return state.attachments.filter((a) => clipsEligible(a.file).ok && a.clip?.status !== 'done');
}

/**
 * Saves `queue` to the Clips Hub, one at a time (clips-host drives a single app.clickup.com tab).
 * clips-host decides the workspace (the one the signed-in ClickUp tab is viewing) and does the
 * mint + upload inside that tab. Shows the success card when everything went through.
 */
async function submitClips(queue = pendingClips()) {
  showError('');
  if (!queue.length) return showError('Record or attach a video to save to Clips.');

  setBusy(true);
  let failed = 0;
  let hubUrl = '';
  try {
    for (const a of queue) {
      if (a.clip?.status === 'done') continue;
      a.clip = { status: 'uploading', progress: null };
      renderAttachments();
      try {
        const res = await uploadClipViaTab(a.file, (p) => {
          a.clip.progress = p;
          updateClipProgress(a);
        });
        hubUrl = clipsHubUrl(res.workspaceId);
        a.clip = { status: 'done', hubUrl };
        // Forget it now, not on "Record another": closing the panel after the success card would
        // otherwise bring the file back as pending, and the next save would make a duplicate Clip.
        forgetPending(a);
        a.dbId = undefined;
      } catch (err) {
        console.warn('[clip] upload failed', err?.status, err?.message);
        a.clip = { status: 'failed', error: err.message };
        failed++;
        // Signed out fails every clip the same way — stop early.
        if (err.status === 401) {
          queue.filter((q) => q !== a && q.clip?.status !== 'done').forEach((q) => {
            q.clip = { status: 'failed', error: 'Skipped' };
            failed++;
          });
          break;
        }
      }
      renderAttachments();
    }
    if (failed) {
      showError(`${failed} clip${failed > 1 ? 's' : ''} failed to save. Fix the issue and press Retry.`);
      return;
    }
    showClipsSuccess(queue.length, hubUrl);
  } finally {
    setBusy(false);
  }
}

function showClipsSuccess(count, hubUrl) {
  el.successTitle.textContent = 'Saved to Clips';
  el.successLink.href = hubUrl;
  el.successLink.textContent = 'Open Clips Hub ↗';
  el.successDetail.textContent = `${count} clip${count > 1 ? 's' : ''} saved. ClickUp is transcribing ${count > 1 ? 'them' : 'it'}.`;
  el.successAgain.textContent = 'Record another';
  el.success.hidden = false;
  el.formArea.hidden = true;
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
  setBubble: (bubble) => sendToBackground({ type: 'rec:bubble', bubble }),
  pause: () => sendToBackground({ type: 'rec:pause' }),
  resume: () => sendToBackground({ type: 'rec:resume' }),
  setMicMuted: (muted) => sendToBackground({ type: 'rec:mute', muted }),
  screenshot: () => sendToBackground({ type: 'shot:screen' }),
  // The offscreen recorder is shared by every panel of this profile; Stop from any of them counts.
  ownsSession: () => true,
};

function createLocalHost() {
  const session = createCaptureSession({
    // The user ended sharing from the browser's own indicator.
    onFinished: ({ error }) => sendToBackground({ type: 'rec:state', recording: null, error }),
    // The countdown ran out, or the recording was paused, resumed, muted (from here or from
    // another window's sidebar): this sidebar runs the recorder, so it reports the new state.
    onChange: (recording) => sendToBackground({ type: 'rec:state', recording, update: true }).catch(console.error),
  });
  const failure = (err) => ({ ok: false, name: err?.name, error: err?.message ?? String(err ?? 'unknown error') });

  /** A pause/resume/mute command: ours to run, or for the recording sidebar in another window. */
  function control(msg) {
    if (session.isRecording()) return session.handle(msg).catch(failure);
    return chrome.runtime.sendMessage({ target: 'host', ...msg }).then(
      (res) => res ?? { ok: false, error: 'No sidebar is recording.' },
      failure,
    );
  }

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
      error:
        session.state() === 'countdown'
          ? 'Recording cancelled because the sidebar was closed.'
          : 'Recording stopped because the sidebar was closed. The part recorded so far was kept.',
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
      await sendToBackground({ type: 'rec:state', recording: res.recording });
      return res;
    },
    setBubble(bubble) {
      // Ours, or the recording sidebar in another window.
      if (session.isRecording()) return session.setBubble(bubble);
      return chrome.runtime.sendMessage({ target: 'host', type: 'rec:bubble', bubble }).catch(() => ({ ok: false }));
    },
    pause: () => control({ type: 'rec:pause' }),
    resume: () => control({ type: 'rec:resume' }),
    setMicMuted: (muted) => control({ type: 'rec:mute', muted }),
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
    // Stopping another window's recording doesn't make it ours (that sidebar auto-saves, not this one).
    ownsSession: () => session.isRecording(),
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
      createdAt: record.createdAt,
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
  el.recBubble.hidden = !state.recording?.camera;
  if (state.recording?.camera) recBubbleStage.setValue(recorderCard.options().bubble);
  if (state.recording) {
    renderRecordingStrip();
    recTimer = setInterval(renderRecordingStrip, 250); // 250 ms: the countdown's 3-2-1 shouldn't lag
  }
  render();
}

/** Recording strip: "Starting in 3" → "Recording 00:12" ⇄ "Paused 00:12", plus Pause and Mute. */
let recControlBusy = false; // a pause/resume/mute is on its way to the recorder
function renderRecordingStrip() {
  const recording = state.recording;
  if (!recording) return;
  const now = Date.now();
  const phase = recordingPhase(recording, now);
  el.recording.dataset.phase = phase;
  el.recLabel.textContent = { countdown: 'Starting in', paused: 'Paused', recording: 'Recording' }[phase];
  el.recTime.textContent = phase === 'countdown' ? String(countdownLeft(recording, now)) : formatDuration(elapsedMs(recording, now));

  const paused = phase === 'paused';
  el.btnPause.disabled = phase === 'countdown' || recControlBusy;
  setToggle(el.btnPause, paused, paused ? 'play' : 'pause', paused ? 'Resume recording' : 'Pause recording');

  el.btnMute.hidden = !recording.mic;
  el.btnMute.disabled = recControlBusy;
  const muted = !!recording.micMuted;
  setToggle(el.btnMute, muted, muted ? 'micOff' : 'mic', muted ? 'Unmute microphone' : 'Mute microphone');
}

/** An icon-only toggle button: pressed state, icon and accessible name (only touched on change). */
function setToggle(button, pressed, iconName, label) {
  if (button.dataset.icon === iconName && button.getAttribute('aria-pressed') === String(pressed)) return;
  button.dataset.icon = iconName;
  button.innerHTML = icon(iconName);
  button.setAttribute('aria-pressed', String(pressed));
  button.setAttribute('aria-label', label);
  button.title = label;
}

async function recControl(run, what) {
  recControlBusy = true;
  renderRecordingStrip();
  try {
    const res = await run();
    if (!res?.ok) showError(`Could not ${what}: ${res?.error || 'unknown error'}`);
  } catch (err) {
    showError(`Could not ${what}: ${err.message}`);
  } finally {
    recControlBusy = false;
    renderRecordingStrip();
  }
}

el.btnPause.addEventListener('click', () => {
  if (state.recording?.pausedAt) recControl(() => host.resume(), 'resume the recording');
  else recControl(() => host.pause(), 'pause the recording');
});

el.btnMute.addEventListener('click', () => {
  const muted = !state.recording?.micMuted;
  recControl(() => host.setMicMuted(muted), muted ? 'mute the microphone' : 'unmute the microphone');
});

/**
 * A recording ended while this panel was open (the file is in IndexedDB before the state flips):
 * list it, and in the Clips tab with auto-save on, save it right away — but only if this panel
 * owns it. Boot and recovery never set `recordingOwned`, so a clip found on disk is never
 * uploaded unasked. (Two Chrome windows with open panels, one started it and the other pressed
 * Stop: both own it and both would save; accepted.)
 */
async function onRecordingEnded({ startedAt }) {
  const owned = state.recordingOwned;
  state.recordingOwned = false;
  await syncPending();
  if (!owned || state.mode !== 'clips' || !state.clipsAutoSave || state.busy) return;
  const fresh = state.attachments.filter((a) => a.dbId && a.createdAt >= startedAt && !a.clip && clipsEligible(a.file).ok);
  if (fresh.length) submitClips(fresh);
}

chrome.storage.session.onChanged.addListener((changes) => {
  if ('recording' in changes) {
    const ended = state.recording && !changes.recording.newValue ? state.recording : null;
    applyRecordingState(changes.recording.newValue);
    if (ended) onRecordingEnded(ended);
  }
  if (changes.recordingError?.newValue) showError(changes.recordingError.newValue);
  if ('attachmentsChangedAt' in changes) syncPending();
});

// Moving the bubble mid-recording: the stage fires on every drag move, so coalesce the
// messages to the recorder (prefs are only written once the drag ends).
let bubbleSendTimer = 0;
let bubblePending = null;
function sendBubble(bubble, { final }) {
  bubblePending = bubble;
  if (final) recorderCard.setBubble(bubble);
  if (bubbleSendTimer) return;
  bubbleSendTimer = setTimeout(() => {
    bubbleSendTimer = 0;
    Promise.resolve(host.setBubble(bubblePending)).catch((err) => console.error('Moving the camera bubble failed', err));
  }, final ? 0 : 50);
}
const recBubbleStage = createBubbleStage($('rec-bubble-stage'), {
  value: recorderCard.options().bubble,
  onChange: sendBubble,
  label: 'Camera bubble in the recording',
});

el.btnRecord.addEventListener('click', async () => {
  showError('');
  el.micNotice.hidden = true;
  el.cameraNotice.hidden = true;
  el.blurNotice.hidden = true;
  el.btnRecord.disabled = true;
  el.recordHint.textContent = `Choose what to share in ${browserName()}’s picker…`;
  recorderCard.releaseDevices(); // the level meter and the preview hold the mic/camera; the recorder needs them
  try {
    const res = await host.start(recorderCard.options());
    el.recordHint.textContent = '';
    if (res?.ok) {
      state.recordingOwned = true;
      if (res.micError) el.micNotice.hidden = false;
      if (res.cameraError) el.cameraNotice.hidden = false;
      if (res.blurError) {
        console.warn('Background blur:', res.blurError);
        el.blurNotice.hidden = false;
      }
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
  if (host.ownsSession()) state.recordingOwned = true; // pressing Stop here is as good as having started it
  try {
    const res = await host.stop();
    if (!res?.ok) showError(`Recording stopped with an error: ${res?.error || 'unknown error'}`);
    else if (res.cancelled) el.recordHint.textContent = 'Recording cancelled.';
  } catch (err) {
    showError(err.message);
  } finally {
    el.btnStop.disabled = false;
  }
});

el.btnGrantMic.addEventListener('click', () => openGrant('microphone'));
el.btnGrantCamera.addEventListener('click', () => openGrant('camera'));

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
  if (state.mode === 'clips') return submitClips();

  const comment = state.mode === 'existing' ? el.commentText.value.trim() : '';

  // Resolve the target task (unless a previous attempt already created / found it).
  let extra;
  if (!state.target) {
    if (state.mode === 'new') {
      if (!el.list.value) {
        el.location.open = true;
        ([el.workspace, el.space, el.list].find((s) => !s.value) || el.list).focus();
        return showError('Pick a list for the new task.');
      }
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
          markdown_description: descEditor.getMarkdown(),
          status: el.status.value || undefined,
          priority: el.priority.value ? Number(el.priority.value) : undefined,
          assignees: extra.assignees,
          tags: extra.tags,
          due_date: extra.due_date,
          due_date_time: extra.due_date_time,
          custom_fields: extra.custom_fields,
        });
        state.target = { id: task.id, url: task.url, name: task.name, customTaskIds: false, created: true, teamId: task.team_id };
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
  descEditor.clear();
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
  descEditor.setDisabled(state.busy || !!state.target); // a disabled fieldset doesn't stop contenteditable
  el.submit.disabled = recording;

  if (state.busy) el.submit.textContent = 'Working…';
  else if (state.mode === 'clips') {
    const n = pendingClips().length;
    if (state.attachments.some((a) => a.clip?.status === 'failed')) el.submit.textContent = 'Retry failed clips';
    else el.submit.textContent = n > 1 ? `Save ${n} clips` : 'Save to Clips';
  } else if (hasFailed && state.target) el.submit.textContent = 'Retry failed uploads';
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
// Reopen on the destination tab used last, with its Clips settings.
{
  const prefs = await getPrefs();
  state.clipsAutoSave = !!prefs.clips?.autoSave;
  el.clipsAutoSave.checked = state.clipsAutoSave;
  setMode(['existing', 'clips'].includes(prefs.mode) ? prefs.mode : 'new', { persist: false });
}
if (isSidebar()) await recoverAfterSidebarClosed();
await syncPending();
await applyToken(await getToken());
await detectTaskFromActiveTab();
