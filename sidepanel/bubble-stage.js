// Camera bubble control: a small 16:9 "stage" standing in for the recording, with a draggable
// circle (the bubble) and S / M / L size buttons. Emits { x, y, size } in the shape
// lib/geometry.js `bubbleRect` consumes, so what you see here is where the bubble lands in the
// clip. Used in the Record clip card (with a live camera preview inside the circle) and in the
// recording strip to move the bubble of a running recording.
import { bubbleRect, snapToCorner } from '../lib/geometry.js';
import { icon } from '../lib/icons.js';

const SIZES = [
  { value: 'sm', label: 'S', title: 'Small bubble' },
  { value: 'md', label: 'M', title: 'Medium bubble' },
  { value: 'lg', label: 'L', title: 'Large bubble' },
];
const NUDGE = 0.05;

/**
 * @param {HTMLElement} root  empty container
 * @param {{ value: { x: number, y: number, size: string },
 *           onChange: (bubble: { x: number, y: number, size: string }, info: { final: boolean }) => void,
 *           label?: string }} opts
 *   `onChange` fires on every drag move (`final: false`) and once the pointer is released,
 *   a key was pressed or a size picked (`final: true`, position snapped to a nearby corner).
 */
export function createBubbleStage(root, { value, onChange, label = 'Camera bubble' }) {
  let current = { x: 0, y: 1, size: 'md', ...value };
  let disabled = false;

  root.classList.add('bubble-ctl');
  root.innerHTML = `
    <div class="bubble-stage" role="group">
      <div class="bubble-dot" tabindex="0" role="button">
        <video muted playsinline hidden></video>
        <span class="bubble-dot-icon">${icon('webcam')}</span>
      </div>
    </div>
    <div class="bubble-size" role="group" aria-label="Bubble size"></div>`;
  const stage = root.querySelector('.bubble-stage');
  const dot = root.querySelector('.bubble-dot');
  const video = dot.querySelector('video');
  const sizes = root.querySelector('.bubble-size');
  stage.setAttribute('aria-label', label);
  dot.setAttribute('aria-label', `${label} position: drag it, or move it with the arrow keys`);

  for (const s of SIZES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s.label;
    b.title = s.title;
    b.dataset.size = s.value;
    b.addEventListener('click', () => commit({ size: s.value }));
    sizes.append(b);
  }

  function layout() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    for (const b of sizes.children) b.setAttribute('aria-pressed', String(b.dataset.size === current.size));
    if (!w || !h) return;
    const { x, y, r } = bubbleRect({ canvasW: w, canvasH: h, layout: current });
    dot.style.width = `${2 * r}px`;
    dot.style.height = `${2 * r}px`;
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
  }

  /** Stage pixel → position fraction: the inverse of bubbleRect for this stage size. */
  function fractionAt(px, py) {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const origin = bubbleRect({ canvasW: w, canvasH: h, layout: { x: 0, y: 0, size: current.size } });
    const end = bubbleRect({ canvasW: w, canvasH: h, layout: { x: 1, y: 1, size: current.size } });
    const spanX = end.x - origin.x;
    const spanY = end.y - origin.y;
    return {
      x: spanX > 0 ? Math.min(1, Math.max(0, (px - origin.x) / spanX)) : 0.5,
      y: spanY > 0 ? Math.min(1, Math.max(0, (py - origin.y) / spanY)) : 0.5,
    };
  }

  function commit(patch, final = true) {
    current = { ...current, ...patch };
    if (final) current = { ...current, ...snapToCorner(current) };
    layout();
    onChange(current, { final });
  }

  // ---- Drag ----
  let drag = null; // { dx, dy }: pointer offset from the dot's centre
  dot.addEventListener('pointerdown', (e) => {
    if (disabled || e.button !== 0) return;
    const rect = stage.getBoundingClientRect();
    const { x, y } = bubbleRect({ canvasW: rect.width, canvasH: rect.height, layout: current });
    drag = { dx: e.clientX - rect.left - x, dy: e.clientY - rect.top - y };
    dot.setPointerCapture(e.pointerId);
    dot.classList.add('dragging');
    e.preventDefault();
  });
  dot.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const rect = stage.getBoundingClientRect();
    commit(fractionAt(e.clientX - rect.left - drag.dx, e.clientY - rect.top - drag.dy), false);
  });
  const endDrag = (e) => {
    if (!drag) return;
    drag = null;
    dot.classList.remove('dragging');
    if (dot.hasPointerCapture?.(e.pointerId)) dot.releasePointerCapture(e.pointerId);
    commit({}, true); // snap + final
  };
  dot.addEventListener('pointerup', endDrag);
  dot.addEventListener('pointercancel', endDrag);

  // ---- Keyboard ----
  dot.addEventListener('keydown', (e) => {
    if (disabled) return;
    const step = { ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE] }[e.key];
    if (!step) return;
    e.preventDefault();
    commit({ x: current.x + step[0], y: current.y + step[1] }, true);
  });

  // Keep the dot in place when the panel is resized.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layout).observe(stage);
  layout();

  return {
    setValue(bubble) {
      current = { ...current, ...bubble };
      layout();
    },
    setDisabled(on) {
      disabled = on;
      root.classList.toggle('disabled', on);
      for (const b of sizes.children) b.disabled = on;
      dot.tabIndex = on ? -1 : 0;
    },
    /** Shows a live camera stream inside the bubble (null removes it). */
    attachPreview(stream) {
      video.srcObject = stream;
      video.hidden = !stream;
      if (stream) video.play().catch(() => {});
    },
    get value() {
      return { ...current };
    },
  };
}
