// Screenshot annotation editor: draw, text, blur (pixelate), crop — with undo/redo.
//
// Edits are kept as a list of operations in *image pixel* coordinates and replayed on top
// of the original screenshot on every render. Undo/redo is just moving ops between stacks,
// and the exported image is always full resolution. The current crop is the last crop op.
import { getAttachment, updateAttachment, deleteAttachment, notifyAttachmentsChanged } from '../lib/attachments-db.js';

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const stage = $('stage');
const wrap = $('canvas-wrap');
const textInput = $('text-input');
const hint = $('hint');
const message = $('message');
const undoBtn = $('undo');
const redoBtn = $('redo');
const attachBtn = $('attach');
const cancelBtn = $('cancel');

const params = new URLSearchParams(location.search);
const draftId = Number(params.get('draft'));
const returnTabId = Number(params.get('returnTab')) || null;

const COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#0090ff', '#7b68ee', '#1f1f29', '#ffffff'];
const STROKE = { s: 3, m: 6, l: 12 }; // on-screen px
const FONT = { s: 16, m: 24, l: 36 }; // on-screen px
const MIN_RECT = 4; // on-screen px; smaller drags are ignored

const HINTS = {
  pen: 'Drag to draw.',
  text: 'Click where the text should go. Enter to place it, Shift+Enter for a new line, Esc to cancel.',
  blur: 'Drag over anything you want to hide (passwords, emails, names…).',
  crop: 'Drag to select the part to keep. Undo to get the full screenshot back.',
};

const state = {
  tool: 'pen',
  color: COLORS[0],
  size: 'm',
  ops: [],
  redo: [],
  /** Op being drawn right now (not yet in `ops`). */
  live: null,
  /** Open text box: { x, y } in image px, plus a unique id. */
  text: null,
};
let textBoxId = 0;

let record = null; // IndexedDB draft
let base = null; // ImageBitmap of the original screenshot
const composite = document.createElement('canvas'); // full-size image with all ops applied
const cctx = composite.getContext('2d', { willReadFrequently: true });
const pixelCanvases = [document.createElement('canvas'), document.createElement('canvas')]; // pixelation scratch
let view = { scale: 1, crop: { x: 0, y: 0, w: 0, h: 0 } }; // css px per image px
let finished = false;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function currentCrop() {
  for (let i = state.ops.length - 1; i >= 0; i--) if (state.ops[i].type === 'crop') return state.ops[i].rect;
  return { x: 0, y: 0, w: base.width, h: base.height };
}

/** Normalizes a dragged rect (may have negative w/h), clamps it to `bounds`, rounds to pixels. */
function normRect(r, bounds) {
  let x1 = Math.min(r.x, r.x + r.w);
  let y1 = Math.min(r.y, r.y + r.h);
  let x2 = Math.max(r.x, r.x + r.w);
  let y2 = Math.max(r.y, r.y + r.h);
  x1 = Math.max(bounds.x, Math.round(x1));
  y1 = Math.max(bounds.y, Math.round(y1));
  x2 = Math.min(bounds.x + bounds.w, Math.round(x2));
  y2 = Math.min(bounds.y + bounds.h, Math.round(y2));
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

/** Pointer event → image pixel coordinates. */
function toImage(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: view.crop.x + (e.clientX - r.left) / view.scale,
    y: view.crop.y + (e.clientY - r.top) / view.scale,
  };
}

// ---------------------------------------------------------------------------
// Drawing ops
// ---------------------------------------------------------------------------

/**
 * Mosaic-pixelates a region. A single big downscale only *samples* pixels (leaving glyph
 * fragments), so shrink in halving steps — each step averages 2×2 pixels — until close to
 * the block grid, then scale back up with nearest-neighbour.
 */
function pixelate(c, r) {
  if (r.w < 1 || r.h < 1) return;
  const block = Math.max(10, Math.round(Math.min(r.w, r.h) / 4));
  const sw = Math.max(1, Math.ceil(r.w / block));
  const sh = Math.max(1, Math.ceil(r.h / block));

  let src = c.canvas;
  let sx = r.x;
  let sy = r.y;
  let w = r.w;
  let h = r.h;
  let i = 0;
  const step = (nw, nh) => {
    const dst = pixelCanvases[i++ % 2]; // ping-pong, so dst is never src
    dst.width = nw;
    dst.height = nh;
    const d = dst.getContext('2d');
    d.imageSmoothingEnabled = true;
    d.imageSmoothingQuality = 'high';
    d.drawImage(src, sx, sy, w, h, 0, 0, nw, nh);
    src = dst;
    sx = sy = 0;
    w = nw;
    h = nh;
  };
  while (w / 2 >= sw && h / 2 >= sh) step(Math.ceil(w / 2), Math.ceil(h / 2));
  step(sw, sh);

  c.save();
  c.imageSmoothingEnabled = false;
  c.drawImage(src, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
  c.restore();
}

function drawOp(c, op) {
  switch (op.type) {
    case 'pen': {
      c.save();
      c.strokeStyle = op.color;
      c.lineWidth = op.width;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.beginPath();
      const [first, ...rest] = op.points;
      c.moveTo(first.x, first.y);
      if (!rest.length) c.lineTo(first.x + 0.01, first.y); // a click draws a dot
      for (const p of rest) c.lineTo(p.x, p.y);
      c.stroke();
      c.restore();
      break;
    }
    case 'text': {
      c.save();
      c.font = `600 ${op.size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      c.textBaseline = 'top';
      c.fillStyle = op.color;
      const lineHeight = op.size * 1.2;
      const pad = (lineHeight - op.size) / 2; // match the textarea's half-leading
      op.text.split('\n').forEach((line, i) => c.fillText(line, op.x, op.y + pad + i * lineHeight));
      c.restore();
      break;
    }
    case 'blur':
      pixelate(c, normRect(op.rect, { x: 0, y: 0, w: c.canvas.width, h: c.canvas.height }));
      break;
    // 'crop' only changes the visible region — see currentCrop().
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderComposite() {
  cctx.drawImage(base, 0, 0);
  for (const op of state.ops) drawOp(cctx, op);
  if (state.live && state.live.type !== 'crop') drawOp(cctx, state.live);
}

function layout() {
  const crop = currentCrop();
  const availW = Math.max(100, stage.clientWidth - 48);
  const availH = Math.max(100, stage.clientHeight - 48);
  // Never upscale past the screenshot's natural CSS size (it was captured at devicePixelRatio).
  const scale = Math.min(availW / crop.w, availH / crop.h, 1 / window.devicePixelRatio);
  const cssW = Math.max(1, Math.round(crop.w * scale));
  const cssH = Math.max(1, Math.round(crop.h * scale));
  const dpr = window.devicePixelRatio;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  view = { scale: cssW / crop.w, crop };
}

/** Image rect → device-pixel rect on the display canvas. */
function toCanvasRect(r) {
  const k = view.scale * window.devicePixelRatio;
  return { x: (r.x - view.crop.x) * k, y: (r.y - view.crop.y) * k, w: r.w * k, h: r.h * k };
}

function drawSelection(r, dim) {
  const d = toCanvasRect(r);
  ctx.save();
  if (dim) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(d.x, d.y, d.w, d.h);
    ctx.fill('evenodd');
  }
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = Math.max(1, window.devicePixelRatio);
  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(d.x, d.y, d.w, d.h);
  ctx.restore();
}

function render() {
  renderComposite();
  layout();
  const { crop } = view;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(composite, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);

  if (state.live?.type === 'crop') drawSelection(normRect(state.live.rect, crop), true);
  if (state.live?.type === 'blur') drawSelection(normRect(state.live.rect, crop), false);

  undoBtn.disabled = !state.ops.length;
  redoBtn.disabled = !state.redo.length;
}

let frame = 0;
function scheduleRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    render();
  });
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function commit(op) {
  state.ops.push(op);
  state.redo = [];
  render();
}

function undo() {
  if (!state.ops.length) return;
  state.redo.push(state.ops.pop());
  render();
}

function redo() {
  if (!state.redo.length) return;
  state.ops.push(state.redo.pop());
  render();
}

// ---------------------------------------------------------------------------
// Pointer interaction
// ---------------------------------------------------------------------------

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (state.tool === 'text') {
    // Let the open box commit on blur first, then start a new one here.
    e.preventDefault();
    if (state.text) commitText();
    openText(e);
    return;
  }

  canvas.setPointerCapture(e.pointerId);
  const p = toImage(e);
  if (state.tool === 'pen') {
    state.live = { type: 'pen', color: state.color, width: STROKE[state.size] / view.scale, points: [p] };
  } else {
    state.live = { type: state.tool, rect: { x: p.x, y: p.y, w: 0, h: 0 } };
  }
  scheduleRender();
});

canvas.addEventListener('pointermove', (e) => {
  const live = state.live;
  if (!live) return;
  const p = toImage(e);
  if (live.type === 'pen') live.points.push(p);
  else {
    live.rect.w = p.x - live.rect.x;
    live.rect.h = p.y - live.rect.y;
  }
  scheduleRender();
});

function endPointer() {
  const live = state.live;
  if (!live) return;
  state.live = null;
  if (live.type === 'pen') return commit(live);

  const rect = normRect(live.rect, view.crop);
  const min = MIN_RECT / view.scale;
  if (rect.w < min || rect.h < min) return render();
  commit({ type: live.type, rect });
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

// ---------------------------------------------------------------------------
// Text tool
// ---------------------------------------------------------------------------

function openText(e) {
  const r = canvas.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  state.text = { ...toImage(e), id: ++textBoxId };
  Object.assign(textInput.style, {
    left: `${e.clientX - wrapRect.left}px`,
    top: `${e.clientY - wrapRect.top}px`,
    fontSize: `${FONT[state.size]}px`,
    color: state.color,
    maxWidth: `${r.right - e.clientX}px`,
  });
  textInput.value = '';
  textInput.hidden = false;
  // Focus after the pointerdown finishes, or the canvas steals it back.
  setTimeout(() => textInput.focus());
}

function commitText() {
  if (!state.text) return;
  const text = textInput.value.replace(/\s+$/, '');
  const { x, y } = state.text;
  closeText();
  if (text) {
    commit({ type: 'text', x, y, text, color: state.color, size: FONT[state.size] / view.scale });
  }
}

function closeText() {
  state.text = null;
  textInput.hidden = true;
  textInput.value = '';
}

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    commitText();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeText();
  }
  e.stopPropagation(); // keep tool shortcuts out of typing
});
// Clicking away commits the box. Deferred and tied to this box's id, so a blur caused by
// closing one box can never commit the next (still empty) one.
textInput.addEventListener('blur', () => {
  const id = state.text?.id;
  if (!id) return;
  setTimeout(() => {
    if (state.text?.id === id && document.activeElement !== textInput) commitText();
  });
});

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function setTool(tool) {
  if (state.text) commitText();
  state.tool = tool;
  canvas.dataset.tool = tool;
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  hint.textContent = HINTS[tool];
}

function setColor(color) {
  state.color = color;
  document.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('active', b.dataset.color === color));
  if (state.text) textInput.style.color = color;
}

function setSize(size) {
  state.size = size;
  document.querySelectorAll('.size').forEach((b) => b.classList.toggle('active', b.dataset.size === size));
  if (state.text) textInput.style.fontSize = `${FONT[size]}px`;
}

const colorGroup = $('colors');
for (const color of COLORS) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.dataset.color = color;
  b.style.setProperty('--c', color);
  b.title = color;
  // mousedown default would blur the text box and commit it in the old color
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', () => setColor(color));
  colorGroup.append(b);
}

document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
document.querySelectorAll('.size').forEach((b) => {
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', () => setSize(b.dataset.size));
});
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

document.addEventListener('keydown', (e) => {
  if (e.target === textInput) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (mod && key === 'y') {
    e.preventDefault();
    redo();
  } else if (!mod && !e.altKey) {
    const tool = { p: 'pen', t: 'text', b: 'blur', c: 'crop' }[key];
    if (tool) setTool(tool);
  }
});

window.addEventListener('resize', scheduleRender);

// ---------------------------------------------------------------------------
// Attach / cancel
// ---------------------------------------------------------------------------

async function closeEditor() {
  finished = true;
  if (returnTabId) await chrome.tabs.update(returnTabId, { active: true }).catch(() => {});
  const self = await chrome.tabs.getCurrent();
  if (self) chrome.tabs.remove(self.id);
  else window.close();
}

async function exportImage() {
  if (state.text) commitText();
  state.live = null;
  renderComposite();
  const crop = currentCrop();
  const out = document.createElement('canvas');
  out.width = crop.w;
  out.height = crop.h;
  out.getContext('2d').drawImage(composite, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  return new File([blob], record.file.name, { type: 'image/png' });
}

attachBtn.addEventListener('click', async () => {
  attachBtn.disabled = cancelBtn.disabled = true;
  try {
    const file = await exportImage();
    await updateAttachment(draftId, { file, draft: false, crop: null });
    await notifyAttachmentsChanged();
    await closeEditor();
  } catch (err) {
    showMessage(`Could not attach the screenshot: ${err.message}`);
    attachBtn.disabled = cancelBtn.disabled = false;
  }
});

cancelBtn.addEventListener('click', async () => {
  await deleteAttachment(draftId).catch(() => {});
  await closeEditor();
});

window.addEventListener('beforeunload', (e) => {
  if (!finished && state.ops.length) e.preventDefault(); // confirm before losing edits
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function showMessage(text) {
  message.textContent = text;
  message.hidden = false;
}

async function boot() {
  setTool('pen');
  setColor(COLORS[0]);
  setSize('m');

  record = draftId ? await getAttachment(draftId).catch(() => null) : null;
  if (!record) {
    document.querySelector('.toolbar').querySelectorAll('button').forEach((b) => (b.disabled = true));
    cancelBtn.disabled = false;
    wrap.hidden = true;
    showMessage('This screenshot is no longer available. Take a new one from the side panel.');
    return;
  }

  base = await createImageBitmap(record.file);
  composite.width = base.width;
  composite.height = base.height;

  // "Select area" arrives as an initial crop (CSS px of the captured page) — undo restores the full shot.
  if (record.crop) {
    const s = base.width / record.crop.viewportWidth;
    const rect = normRect(
      { x: record.crop.x * s, y: record.crop.y * s, w: record.crop.w * s, h: record.crop.h * s },
      { x: 0, y: 0, w: base.width, h: base.height },
    );
    if (rect.w > 0 && rect.h > 0) state.ops.push({ type: 'crop', rect });
  }

  render();
}

boot();
