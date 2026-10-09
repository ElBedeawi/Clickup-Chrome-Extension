// Screenshot capture: the visible tab, or an area the user drags out on the page.
// The capture is stored as a draft in IndexedDB and opened in the editor tab.
import { saveAttachment } from './attachments-db.js';
import { siteAccessHint } from './platform.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

export function screenshotFileName(date = new Date()) {
  return `screenshot-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.png`;
}

/**
 * Injected into the page. Shows a crosshair overlay; resolves with the dragged rectangle
 * in CSS px (plus the viewport width, to scale onto the captured image), or null if cancelled.
 * Must be self-contained — it's serialized and run in the page.
 */
function selectAreaOnPage() {
  const ID = '__clickup_video_upload_area_select__';
  document.getElementById(ID)?.remove();

  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.id = ID;
    root.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,.3);user-select:none;';

    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;display:none;pointer-events:none;border:2px solid #7b68ee;' +
      'box-shadow:0 0 0 100vmax rgba(0,0,0,.4);';

    const hint = document.createElement('div');
    hint.textContent = 'Drag to select an area · Esc or click to cancel';
    hint.style.cssText =
      'position:fixed;top:16px;left:50%;transform:translateX(-50%);padding:6px 12px;border-radius:6px;' +
      'background:#1f1f29;color:#fff;font:13px system-ui,sans-serif;pointer-events:none;';

    root.append(box, hint);
    document.documentElement.append(root);

    let start = null;
    const rectFrom = (e) => ({
      x: Math.min(start.x, e.clientX),
      y: Math.min(start.y, e.clientY),
      w: Math.abs(e.clientX - start.x),
      h: Math.abs(e.clientY - start.y),
    });

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      }
    };

    function finish(rect) {
      window.removeEventListener('keydown', onKey, true);
      root.remove();
      // Let the page repaint without the overlay before the extension captures it.
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          setTimeout(() => resolve(rect && { ...rect, viewportWidth: window.innerWidth }), 30),
        ),
      );
    }

    root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      root.setPointerCapture(e.pointerId);
      root.style.background = 'transparent'; // the box's shadow dims everything else
      box.style.display = 'block';
      hint.style.display = 'none';
      Object.assign(box.style, { left: `${start.x}px`, top: `${start.y}px`, width: '0px', height: '0px' });
    });
    root.addEventListener('pointermove', (e) => {
      if (!start) return;
      const r = rectFrom(e);
      Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    });
    root.addEventListener('pointerup', (e) => {
      if (!start) return;
      const r = rectFrom(e);
      finish(r.w > 4 && r.h > 4 ? r : null); // a plain click cancels
    });
    window.addEventListener('keydown', onKey, true);
  });
}

/**
 * Captures the active tab and saves it as an editor draft.
 * @param {'visible' | 'area'} mode
 * @returns {Promise<{ draftId: number, tab: chrome.tabs.Tab } | null>} null if the user cancelled
 */
export async function captureScreenshot(mode) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^(https?|file):/.test(tab.url || '')) {
    throw new Error('This page can’t be captured (the browser protects it). Switch to a regular web page and try again.');
  }

  // <all_urls> is declared in the manifest, but the user can still restrict site access.
  // (We don't prompt with permissions.request — it's unreliable from a side panel.)
  const url = new URL(tab.url);
  const origin = url.protocol === 'file:' ? 'file:///*' : `${url.origin}/*`;
  if (!(await chrome.permissions.contains({ origins: [origin] }))) {
    throw new Error(`The extension isn’t allowed to read this site. ${siteAccessHint()}`);
  }

  let crop;
  if (mode === 'area') {
    let results;
    try {
      results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: selectAreaOnPage });
    } catch {
      throw new Error('Selecting an area isn’t possible on this page (the browser protects it). Try “Visible tab” instead.');
    }
    crop = results?.[0]?.result;
    if (!crop) return null; // cancelled
  }

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], screenshotFileName(), { type: 'image/png' });
  const draftId = await saveAttachment(file, { draft: true, crop });
  return { draftId, tab };
}

/** Opens the annotation editor next to the captured tab. */
export function openEditor(draftId, tab) {
  const url = chrome.runtime.getURL(`editor/editor.html?draft=${draftId}&returnTab=${tab.id}`);
  return chrome.tabs.create({ url, windowId: tab.windowId, index: tab.index + 1 });
}
