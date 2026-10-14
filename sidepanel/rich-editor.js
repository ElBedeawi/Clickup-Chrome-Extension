// Rich-text editor for the task description, after ClickUp's own: a formatting toolbar over a
// contenteditable, with Markdown typing shortcuts ("- ", "1. ", "[] ", "# ", "> ", ```, ---,
// **bold**, `code`…). Content is limited to what Markdown can express, and `getMarkdown()` turns
// it into the Markdown ClickUp takes as `markdown_description` (lib/markdown.js).
// Built on document.execCommand: deprecated, but implemented by Chrome and Firefox, and it keeps
// the browser's own undo stack (Ctrl+Z) working across toolbar actions.
import { icon } from '../lib/icons.js';
import { toMarkdown, sanitizeTree, safeHref } from '../lib/markdown.js';
import { createMenuSelect } from './menu.js';

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

const BLOCK_ITEMS = [
  { value: 'p', label: 'Normal' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
];

// Toolbar groups; each group wraps as a unit at narrow widths.
const GROUPS = [
  [
    { id: 'bold', icon: 'bold', label: 'Bold', keys: 'B' },
    { id: 'italic', icon: 'italic', label: 'Italic', keys: 'I' },
    { id: 'strike', icon: 'strike', label: 'Strikethrough', keys: 'Shift+X' },
    { id: 'code', icon: 'code', label: 'Inline code', keys: 'E' },
    { id: 'link', icon: 'link', label: 'Link', keys: 'K' },
  ],
  [
    { id: 'ul', icon: 'list', label: 'Bulleted list', keys: 'Shift+8' },
    { id: 'ol', icon: 'listOrdered', label: 'Numbered list', keys: 'Shift+7' },
    { id: 'check', icon: 'listChecks', label: 'Checklist', keys: 'Shift+9' },
    { id: 'quote', icon: 'quote', label: 'Quote' },
    { id: 'pre', icon: 'codeBlock', label: 'Code block' },
    { id: 'hr', icon: 'minus', label: 'Divider' },
  ],
  [
    { id: 'clear', icon: 'clearFormat', label: 'Clear formatting' },
    { id: 'undo', icon: 'undo', label: 'Undo', keys: 'Z' },
    { id: 'redo', icon: 'redo', label: 'Redo', keys: 'Shift+Z' },
  ],
];

// Typed at the start of a paragraph, followed by a space.
const BLOCK_SHORTCUTS = [
  [/^[-*+]\s$/, 'ul'],
  [/^1[.)]\s$/, 'ol'],
  [/^\[[ xX]?\]\s$/, 'check'],
  [/^#\s$/, 'h1'],
  [/^##\s$/, 'h2'],
  [/^###\s$/, 'h3'],
  [/^>\s$/, 'quote'],
];
// Typed as the whole paragraph (no space needed).
const LINE_SHORTCUTS = [
  [/^```$/, 'pre'],
  [/^---$/, 'hr'],
];
// Typed inline: the closing marker converts the run before it.
const INLINE_SHORTCUTS = [
  [/`([^`\s][^`]*)`$/, 'code'],
  [/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, 'b'],
  [/~~([^~\s](?:[^~]*[^~\s])?)~~$/, 's'],
  [/(?:^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, 'i'],
];

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// No value argument unless given: Chrome turns `null` into id="null" on inserted rules.
const exec = (cmd, value) => (value === undefined ? document.execCommand(cmd) : document.execCommand(cmd, false, value));

/**
 * @param {HTMLElement} container  empty element; becomes the editor
 * @param {{ placeholder?: string, labelledBy?: string }} [opts]
 */
export function createRichEditor(container, { placeholder = '', labelledBy } = {}) {
  container.classList.add('rte');
  container.innerHTML = `
    <div class="rte-toolbar" role="toolbar" aria-label="Text formatting">
      <div class="rte-group"><div class="rte-block"></div></div>
      ${GROUPS.map(
        (group) => `<div class="rte-group">${group
          .map((b) => {
            const title = b.keys ? `${b.label} (${MOD}${b.keys})` : b.label;
            return `<button type="button" class="rte-btn" data-cmd="${b.id}" title="${title}" aria-label="${b.label}"${
              ['undo', 'redo', 'hr', 'clear', 'link'].includes(b.id) ? '' : ' aria-pressed="false"'
            } tabindex="-1">${icon(b.icon)}</button>`;
          })
          .join('')}</div>`,
      ).join('')}
    </div>
    <div class="rte-linkbar" hidden>
      <input type="url" spellcheck="false" placeholder="Paste or type a link" aria-label="Link address" />
      <button type="button" class="secondary rte-link-apply">Apply</button>
      <button type="button" class="rte-btn rte-link-remove" title="Remove link" aria-label="Remove link">${icon('x')}</button>
    </div>
    <div class="rte-body rte-empty" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true"></div>`;

  const toolbar = container.querySelector('.rte-toolbar');
  const body = container.querySelector('.rte-body');
  const linkBar = container.querySelector('.rte-linkbar');
  const linkInput = linkBar.querySelector('input');
  const buttons = new Map([...toolbar.querySelectorAll('.rte-btn')].map((b) => [b.dataset.cmd, b]));
  body.dataset.placeholder = placeholder;
  if (labelledBy) body.setAttribute('aria-labelledby', labelledBy);

  const blockMenu = createMenuSelect(container.querySelector('.rte-block'), {
    items: BLOCK_ITEMS,
    value: 'p',
    label: 'Text style',
    onChange(value) {
      restore();
      exec('formatBlock', `<${value}>`);
      changed();
    },
  });
  // Roving tabindex: the toolbar is one tab stop (starting on the style menu), arrows move inside it.
  blockMenu.root.querySelector('button').tabIndex = 0;

  // ---- Selection bookkeeping ---------------------------------------------
  // Toolbar clicks, the style menu and the link bar take focus away from the text; the last
  // selection inside the editor is kept and put back before running a command.
  let saved = null;

  const anchor = () => {
    const sel = getSelection();
    const [node, offset] =
      sel.rangeCount && body.contains(sel.anchorNode) ? [sel.anchorNode, sel.anchorOffset] : [saved?.startContainer, saved?.startOffset];
    // Firefox often anchors on the editor itself after a command: use the child at the offset.
    return node === body ? body.childNodes[Math.min(offset, body.childNodes.length - 1)] || body : node;
  };
  const closestIn = (node, selector) => {
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const found = el?.closest(selector);
    return found && found !== body && body.contains(found) ? found : null;
  };

  function restore() {
    const sel = getSelection();
    const inside = sel.rangeCount && body.contains(sel.anchorNode);
    if (document.activeElement !== body) body.focus({ preventScroll: true });
    if (!inside && saved && body.contains(saved.startContainer)) {
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(saved);
    }
  }

  function placeCaret(node, offset) {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  document.addEventListener('selectionchange', () => {
    const sel = getSelection();
    if (!sel.rangeCount || !body.contains(sel.anchorNode)) return;
    saved = sel.getRangeAt(0).cloneRange();
    updateState();
  });

  function changed() {
    // Lets the empty-state check and listeners (e.g. a form) see programmatic changes too.
    body.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---- Commands -------------------------------------------------------------

  function toggleInlineCode() {
    const sel = getSelection();
    const code = closestIn(sel.anchorNode, 'code');
    if (closestIn(sel.anchorNode, 'pre')) return;
    if (code && sel.isCollapsed) return exitInline(code);
    if (code) {
      const range = document.createRange();
      range.selectNode(code);
      sel.removeAllRanges();
      sel.addRange(range);
      return exec('insertText', code.textContent.replace(/\u200b/g, ''));
    }
    if (sel.isCollapsed) {
      // Start a code run at the caret: type into it, press the button again (or →) to leave.
      exec('insertHTML', '<code data-rte-new="">\u200b</code>');
      const added = body.querySelector('code[data-rte-new]');
      if (added) {
        added.removeAttribute('data-rte-new');
        placeCaret(added.firstChild, 1);
      }
      return;
    }
    wrapSelection('code', sel.toString());
  }

  /** Replaces the selection with `<tag>text</tag>` and puts the caret after it, outside. */
  function wrapSelection(tag, text) {
    exec('insertHTML', `<${tag} data-rte-new="">${escapeHtml(text)}</${tag}>`);
    const added = body.querySelector('[data-rte-new]');
    if (!added) return;
    added.removeAttribute('data-rte-new');
    exitInline(added);
  }

  /** Moves the caret just past an inline element, so typing continues unformatted. */
  function exitInline(el) {
    const next = el.nextSibling;
    if (next?.nodeType === Node.TEXT_NODE && next.nodeValue.length) {
      placeCaret(next, next.nodeValue.startsWith('\u200b') ? 1 : 0);
    } else if (el.nodeName === 'CODE' || el.nodeName === 'A') {
      // No "typing style" to switch off here; the caret needs a text node outside the element.
      const zw = document.createTextNode('\u200b');
      el.after(zw);
      placeCaret(zw, 1);
    } else {
      placeCaret(el.parentNode, Array.prototype.indexOf.call(el.parentNode.childNodes, el) + 1);
    }
    // Chrome otherwise keeps typing in the style it just left.
    for (const [cmd, tags] of [['bold', 'b,strong'], ['italic', 'i,em'], ['strikeThrough', 's,strike,del']]) {
      if (el.matches(tags) && document.queryCommandState(cmd)) exec(cmd);
    }
  }

  function toggleBlock(tag) {
    exec('formatBlock', closestIn(anchor(), tag) ? '<p>' : `<${tag}>`);
  }

  function toggleChecklist() {
    let list = closestIn(anchor(), 'ul, ol');
    if (list?.matches('ul.checklist')) return exec('insertUnorderedList');
    if (!list || list.nodeName === 'OL') exec('insertUnorderedList');
    list = closestIn(anchor(), 'ul');
    if (list) list.classList.add('checklist');
  }

  function bulletList() {
    const list = closestIn(anchor(), 'ul');
    if (!list?.classList.contains('checklist')) return exec('insertUnorderedList');
    list.classList.remove('checklist');
    list.querySelectorAll(':scope > li[data-checked]').forEach((li) => li.removeAttribute('data-checked'));
  }

  function clearFormatting() {
    const sel = getSelection();
    if (sel.isCollapsed) {
      // Nothing selected: reset the whole paragraph, like ClickUp.
      const block = closestIn(anchor(), 'p, h1, h2, h3, li, blockquote, pre');
      if (block) {
        const range = document.createRange();
        range.selectNodeContents(block);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    exec('removeFormat');
    exec('unlink');
    const code = closestIn(anchor(), 'code');
    if (code && !closestIn(code, 'pre')) toggleInlineCode();
    if (closestIn(anchor(), 'h1, h2, h3, blockquote, pre')) exec('formatBlock', '<p>');
    if (closestIn(anchor(), 'ul, ol')) exec(closestIn(anchor(), 'ol') ? 'insertOrderedList' : 'insertUnorderedList');
  }

  const commands = {
    bold: () => exec('bold'),
    italic: () => exec('italic'),
    strike: () => exec('strikeThrough'),
    code: toggleInlineCode,
    link: openLinkBar,
    ul: bulletList,
    ol: () => exec('insertOrderedList'),
    check: toggleChecklist,
    quote: () => toggleBlock('blockquote'),
    pre: () => toggleBlock('pre'),
    hr: () => exec('insertHorizontalRule'),
    clear: clearFormatting,
    undo: () => exec('undo'),
    redo: () => exec('redo'),
    h1: () => exec('formatBlock', '<h1>'),
    h2: () => exec('formatBlock', '<h2>'),
    h3: () => exec('formatBlock', '<h3>'),
  };

  function run(cmd) {
    if (body.contentEditable !== 'true') return;
    restore();
    const sel = getSelection();
    if (sel.rangeCount && body.contains(sel.anchorNode)) saved = sel.getRangeAt(0).cloneRange(); // selectionchange is async
    commands[cmd]();
    if (cmd !== 'link') changed();
    updateState();
  }

  toolbar.addEventListener('mousedown', (e) => {
    // Keep the text selection: toolbar buttons must not take focus from the editor.
    if (e.target.closest('.rte-btn')) e.preventDefault();
  });
  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.rte-btn');
    if (btn && !btn.disabled) run(btn.dataset.cmd);
  });
  toolbar.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || e.target.closest('.ms-menu')) return;
    const items = [blockMenu.root.querySelector('button'), ...buttons.values()];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    items.forEach((b, j) => (b.tabIndex = j === next ? 0 : -1));
    items[next].focus();
  });

  // ---- Links ------------------------------------------------------------------

  function openLinkBar() {
    const a = closestIn(anchor(), 'a');
    const selected = getSelection().toString().trim();
    linkInput.value = a?.getAttribute('href') || (safeHref(selected) ? selected : '');
    linkBar.querySelector('.rte-link-remove').hidden = !a;
    linkBar.hidden = false;
    linkInput.focus();
    linkInput.select();
  }

  function closeLinkBar() {
    linkBar.hidden = true;
    restore();
  }

  /** Selects the whole link around a collapsed caret, so link commands apply to all of it. */
  function selectLink(a) {
    const range = document.createRange();
    range.selectNodeContents(a);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function applyLink() {
    const href = safeHref(linkInput.value);
    if (!href) {
      linkInput.setCustomValidity('Enter a web address (https://…) or an email link (mailto:…).');
      linkInput.reportValidity();
      return;
    }
    closeLinkBar();
    const sel = getSelection();
    const a = closestIn(anchor(), 'a');
    if (a && sel.isCollapsed) selectLink(a);
    if (sel.isCollapsed) {
      exec('insertHTML', `<a href="${escapeHtml(href)}" data-rte-new="">${escapeHtml(linkInput.value.trim())}</a>`);
      const added = body.querySelector('a[data-rte-new]');
      if (added) {
        added.removeAttribute('data-rte-new');
        exitInline(added);
      }
    } else {
      exec('createLink', href);
    }
    changed();
  }

  function removeLink() {
    closeLinkBar();
    const a = closestIn(anchor(), 'a');
    if (a && getSelection().isCollapsed) selectLink(a);
    exec('unlink');
    changed();
  }

  linkInput.addEventListener('input', () => linkInput.setCustomValidity(''));
  linkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyLink();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeLinkBar();
    }
  });
  linkBar.querySelector('.rte-link-apply').addEventListener('click', applyLink);
  linkBar.querySelector('.rte-link-remove').addEventListener('click', removeLink);

  // Links can't be followed by a plain click while editing; Ctrl/⌘+click opens them.
  body.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (a && (e.ctrlKey || e.metaKey) && safeHref(a.getAttribute('href'))) {
      e.preventDefault();
      window.open(a.href, '_blank', 'noopener');
    }
  });

  // ---- Checklists ---------------------------------------------------------------

  function toggleCheck(li) {
    if (li.dataset.checked === 'true') li.removeAttribute('data-checked');
    else li.dataset.checked = 'true';
    changed();
  }

  // The box is the item's ::before, drawn in the list's left padding.
  body.addEventListener('pointerdown', (e) => {
    const li = e.target.closest?.('ul.checklist > li');
    if (!li || !body.contains(li) || body.contentEditable !== 'true') return;
    if (e.clientX >= li.getBoundingClientRect().left) return;
    e.preventDefault();
    toggleCheck(li);
  });

  // ---- Keyboard ---------------------------------------------------------------------

  body.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      const key = e.key.toLowerCase();
      const cmd =
        (!e.shiftKey && { b: 'bold', i: 'italic', e: 'code', k: 'link' }[key]) ||
        (e.shiftKey && key === 'x' && 'strike') ||
        (e.shiftKey && { Digit7: 'ol', Digit8: 'ul', Digit9: 'check' }[e.code]);
      if (cmd) {
        e.preventDefault();
        run(cmd);
        return;
      }
      if (key === 'u') e.preventDefault(); // underline has no Markdown
      if (key === 'enter') {
        const li = closestIn(anchor(), 'ul.checklist > li');
        if (li) {
          e.preventDefault();
          toggleCheck(li);
        }
      }
      return;
    }
    if (e.key === 'Tab' && !e.altKey && closestIn(anchor(), 'li')) {
      e.preventDefault();
      exec(e.shiftKey ? 'outdent' : 'indent');
      changed();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && (leaveBlock('pre') || leaveBlock('blockquote'))) e.preventDefault();
    if (e.key === 'ArrowRight' && !e.shiftKey && leaveInlineCodeAtEnd()) e.preventDefault();
  });

  /** Text of a range with line breaks as '\n'. */
  function rangeText(range) {
    const div = document.createElement('div');
    div.append(range.cloneContents());
    div.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    div.querySelectorAll('p, div').forEach((p) => p.append('\n'));
    return div.textContent.replace(/\u200b/g, '');
  }

  /**
   * Enter on an empty last line of a code block or quote leaves it, like ClickUp: the empty line
   * is dropped and typing continues in a paragraph after the block.
   */
  function leaveBlock(selector) {
    const sel = getSelection();
    const block = closestIn(anchor(), selector);
    if (!block || !sel.isCollapsed) return false;
    const before = document.createRange();
    before.setStart(block, 0);
    before.setEnd(sel.anchorNode, sel.anchorOffset);
    const after = document.createRange();
    after.setStart(sel.anchorNode, sel.anchorOffset);
    after.setEnd(block, block.childNodes.length);
    const head = rangeText(before);
    if (rangeText(after).replace(/\n$/, '') || (head && !head.endsWith('\n'))) return false;

    // Chrome keeps each quote line in its own <blockquote>: just turn the empty one into a paragraph.
    if (!head && block.nodeName === 'BLOCKQUOTE') {
      exec('formatBlock', '<p>');
      if (!closestIn(anchor(), 'blockquote')) return true;
    }
    for (let last = block.lastChild; last; last = block.lastChild) {
      const blank = last.nodeType === Node.TEXT_NODE ? !last.nodeValue.replace(/[\n\u200b]/g, '') : last.nodeName === 'BR' || (/^(P|DIV)$/.test(last.nodeName) && !last.textContent.replace(/\u200b/g, '').trim());
      if (!blank) break;
      last.remove();
    }
    if (block.lastChild?.nodeType === Node.TEXT_NODE) block.lastChild.nodeValue = block.lastChild.nodeValue.replace(/\n+$/, '');
    const p = document.createElement('p');
    p.append(document.createElement('br'));
    block.after(p);
    if (!block.textContent.replace(/\u200b/g, '').trim()) block.remove();
    placeCaret(p, 0);
    changed();
    return true;
  }

  /** → at the very end of inline code steps out of it, so there's always a way to stop typing code. */
  function leaveInlineCodeAtEnd() {
    const sel = getSelection();
    const code = closestIn(anchor(), 'code');
    if (!code || closestIn(code, 'pre') || !sel.isCollapsed) return false;
    const after = document.createRange();
    after.setStart(sel.anchorNode, sel.anchorOffset);
    after.setEnd(code, code.childNodes.length);
    if (after.toString()) return false;
    if (code.nextSibling?.nodeType === Node.TEXT_NODE && code.nextSibling.nodeValue.length) return false; // the browser can step out itself
    exitInline(code);
    return true;
  }

  // Remembers checklist state across Enter, so a new item starts unchecked.
  body.addEventListener('input', (e) => {
    if (e.inputType === 'insertParagraph') {
      const li = closestIn(anchor(), 'ul.checklist > li');
      for (const item of [li, li?.previousElementSibling]) {
        if (item?.nodeName === 'LI' && !item.textContent.replace(/\u200b/g, '').trim()) item.removeAttribute('data-checked');
      }
    }
    // Deferred: execCommand isn't re-entrant, so it can't run inside an input event that one fired.
    if (e.inputType === 'insertText') queueMicrotask(() => markdownShortcut(e.data));
    if (e.inputType === 'insertFromDrop') {
      // Dropped HTML skipped the paste filter: clean the whole document instead.
      const clean = sanitizeTree(body, document.createElement('div'), document);
      body.replaceChildren(...clean.childNodes);
    }
    body.classList.toggle('rte-empty', isEmpty());
  });

  function markdownShortcut(typed) {
    const sel = getSelection();
    if (!typed || !sel.isCollapsed || closestIn(sel.anchorNode, 'pre, code')) return;
    const block = closestIn(sel.anchorNode, 'p, div, h1, h2, h3, li, blockquote') || body;
    const before = document.createRange();
    before.setStart(block, 0);
    before.setEnd(sel.anchorNode, sel.anchorOffset);
    const prefix = before.toString().replace(/\u200b/g, '');

    const inList = block.nodeName === 'LI';
    const plain = block === body || block.nodeName === 'P' || block.nodeName === 'DIV';
    const match = (rules) => rules.find(([re, cmd]) => re.test(prefix) && (plain || (inList && cmd === 'check')))?.[1];
    const blockCmd = (/\s/.test(typed) && match(BLOCK_SHORTCUTS)) || match(LINE_SHORTCUTS);
    if (blockCmd) {
      sel.removeAllRanges();
      sel.addRange(before);
      exec('delete');
      if (inList) closestIn(anchor(), 'ul')?.classList.add('checklist');
      else commands[blockCmd]();
      if (blockCmd === 'check' && /x/i.test(prefix)) {
        const li = closestIn(anchor(), 'li');
        if (li) li.dataset.checked = 'true';
      }
      return;
    }

    // Inline: only within the text node the caret is in.
    const node = sel.anchorNode;
    if (node.nodeType !== Node.TEXT_NODE || !'`*~'.includes(typed)) return;
    const text = node.nodeValue.slice(0, sel.anchorOffset);
    for (const [re, tag] of INLINE_SHORTCUTS) {
      const m = re.exec(text);
      if (!m) continue;
      const full = m[0].slice(m[0].indexOf(tag === 'b' ? '**' : tag === 's' ? '~~' : tag === 'code' ? '`' : '*'));
      const range = document.createRange();
      range.setStart(node, sel.anchorOffset - full.length);
      range.setEnd(node, sel.anchorOffset);
      sel.removeAllRanges();
      sel.addRange(range);
      wrapSelection(tag, m[1]);
      return;
    }
  }

  // ---- Paste ------------------------------------------------------------------------

  body.addEventListener('paste', (e) => {
    const data = e.clipboardData;
    if (!data || data.files.length) return; // files go to the panel's attachment handler
    e.preventDefault();
    const html = data.getData('text/html');
    if (html && !closestIn(anchor(), 'pre, code')) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const clean = sanitizeTree(doc.body, document.createElement('div'), document);
      exec('insertHTML', clean.innerHTML);
    } else {
      exec('insertText', data.getData('text/plain'));
    }
  });

  // ---- State --------------------------------------------------------------------------

  function isEmpty() {
    return !body.textContent.replace(/[\u200b\s]/g, '') && !body.querySelector('hr, li, pre');
  }

  function queryState(cmd) {
    const sel = getSelection();
    if (!sel.rangeCount || !body.contains(sel.anchorNode)) return false;
    try {
      return document.queryCommandState(cmd);
    } catch {
      return false;
    }
  }

  function updateState() {
    const node = anchor();
    const list = closestIn(node, 'ul, ol');
    const pressed = {
      bold: queryState('bold'),
      italic: queryState('italic'),
      strike: queryState('strikeThrough'),
      code: !!closestIn(node, 'code') && !closestIn(node, 'pre'),
      ul: list?.matches('ul:not(.checklist)') ?? false,
      ol: list?.nodeName === 'OL',
      check: list?.matches('ul.checklist') ?? false,
      quote: !!closestIn(node, 'blockquote'),
      pre: !!closestIn(node, 'pre'),
    };
    for (const [cmd, on] of Object.entries(pressed)) buttons.get(cmd)?.setAttribute('aria-pressed', String(on));
    blockMenu.setValue(closestIn(node, 'h1, h2, h3')?.nodeName.toLowerCase() ?? 'p');
  }

  try {
    // Same paragraph markup in Chrome and Firefox: Enter makes a new <p>.
    exec('defaultParagraphSeparator', 'p');
  } catch {
    // Not supported: <div> paragraphs serialise the same way.
  }

  return {
    /** The content as Markdown, '' when empty. */
    getMarkdown: () => toMarkdown(body),
    clear() {
      body.replaceChildren();
      body.classList.add('rte-empty');
      saved = null;
      linkBar.hidden = true;
      updateState();
    },
    /** Replaces the content with (sanitised) HTML. Used by the demo scenes. */
    setHTML(html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      body.replaceChildren(...sanitizeTree(doc.body, document.createElement('div'), document).childNodes);
      body.classList.toggle('rte-empty', isEmpty());
    },
    setDisabled(disabled) {
      body.contentEditable = disabled ? 'false' : 'true';
      body.setAttribute('aria-disabled', String(disabled));
      container.classList.toggle('rte-disabled', disabled);
      buttons.forEach((b) => (b.disabled = disabled));
      blockMenu.setDisabled(disabled);
      if (disabled) linkBar.hidden = true;
    },
    focus: () => body.focus(),
  };
}
