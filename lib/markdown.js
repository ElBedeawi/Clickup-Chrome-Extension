// Rich-text ↔ Markdown helpers for the description editor (sidepanel/rich-editor.js).
// `toMarkdown` turns the editor's DOM into the Markdown ClickUp accepts as `markdown_description`;
// `sanitizeTree` reduces pasted HTML to the few elements the editor (and Markdown) can express.
// Both only touch a minimal node interface (nodeType, nodeName, childNodes, nodeValue,
// getAttribute), so unit tests can feed them plain objects instead of a real DOM.

const TEXT = 3;
const ELEMENT = 1;

const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE', 'TR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'NAV', 'ASIDE', 'FIGURE']);
const DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'META', 'LINK', 'TITLE', 'HEAD', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IMG', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA']);

const children = (node) => Array.from(node.childNodes || []);
const attr = (node, name) => (node.getAttribute ? node.getAttribute(name) : null) || '';
const textOf = (node) =>
  node.nodeType === TEXT ? node.nodeValue || '' : node.nodeName === 'BR' ? '\n' : children(node).map(textOf).join('');

/** Links we keep: web and mail only (no javascript:, data:, chrome-extension:, …). */
export function safeHref(href) {
  const url = String(href || '').trim();
  if (/^(https?:\/\/|mailto:)/i.test(url)) return url;
  if (/^www\./i.test(url)) return `https://${url}`;
  return '';
}

/** Inline formatting a node applies: 'b' | 'i' | 's' | null. Also reads inline styles (pasted or Chrome-merged spans). */
function markOf(node) {
  if (node.nodeType !== ELEMENT) return null;
  const name = node.nodeName;
  const style = attr(node, 'style').toLowerCase();
  // Google Docs wraps everything in <b style="font-weight:normal">.
  if ((name === 'B' || name === 'STRONG') && !/font-weight:\s*(normal|[1-5]00)\b/.test(style)) return 'b';
  if (name === 'I' || name === 'EM') return 'i';
  if (name === 'S' || name === 'STRIKE' || name === 'DEL') return 's';
  if (name === 'SPAN' || name === 'FONT') {
    if (/font-weight:\s*(bold|[6-9]00)\b/.test(style)) return 'b';
    if (/font-style:\s*italic/.test(style)) return 'i';
    if (/text-decoration[^;]*line-through/.test(style)) return 's';
  }
  return null;
}

// ---------------------------------------------------------------------------
// DOM → Markdown
// ---------------------------------------------------------------------------

const MARKS = { b: '**', i: '*', s: '~~' };

function escapeText(s) {
  return s.replace(/[\\`*_~[\]<]/g, '\\$&');
}

/** A line of text must not start a heading, list, quote, rule or setext underline by accident. */
function escapeLineStart(line) {
  return line.replace(/^(#{1,6}(?=\s|$)|>|[-+](?=\s|$)|[-=]+$)/, '\\$1').replace(/^(\d+)([.)])(?=\s|$)/, '$1\\$2');
}

/** Wraps `inner` in a Markdown mark, keeping surrounding spaces outside it (`** x**` wouldn't render). */
function wrap(inner, mark) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
}

function inlineCode(text) {
  const code = text.replace(/\u200b/g, '').replace(/\s+/g, ' ');
  if (!code.trim()) return code;
  const ticks = '`'.repeat(Math.max(1, ...(code.match(/`+/g) || ['']).map((t) => t.length + 1)));
  const pad = code.startsWith('`') || code.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${code}${pad}${ticks}`;
}

/** Inline content of `nodes`. Adjacent siblings with the same mark share one pair of markers. */
function inline(nodes) {
  let out = '';
  for (let i = 0; i < nodes.length; i++) {
    const mark = markOf(nodes[i]);
    if (mark) {
      let j = i;
      while (j + 1 < nodes.length && markOf(nodes[j + 1]) === mark) j++;
      out += wrap(nodes.slice(i, j + 1).map((n) => inline(children(n))).join(''), MARKS[mark]);
      i = j;
    } else {
      out += inlineNode(nodes[i]);
    }
  }
  return out;
}

function inlineNode(node) {
  if (node.nodeType === TEXT) {
    return escapeText((node.nodeValue || '').replace(/\u200b/g, '').replace(/[ \t\r\n\u00a0]+/g, ' '));
  }
  if (node.nodeType !== ELEMENT || DROP.has(node.nodeName)) return '';
  switch (node.nodeName) {
    case 'BR':
      return '\n';
    case 'CODE':
    case 'KBD':
    case 'SAMP':
      return inlineCode(textOf(node));
    case 'A': {
      const text = inline(children(node));
      const href = safeHref(attr(node, 'href'));
      if (!href || !text.trim()) return text;
      return `[${text}](${href.replace(/[ ()]/g, (c) => ({ ' ': '%20', '(': '%28', ')': '%29' })[c])})`;
    }
    default:
      return inline(children(node));
  }
}

/** Cleans up a run of inline Markdown into paragraph lines. */
function paragraph(md) {
  return md
    .split('\n')
    .map((line) => escapeLineStart(line.trim()))
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
    .replace(/\n{2,}/g, '\n');
}

const isChecklist = (list) => /(^|\s)checklist(\s|$)/.test(attr(list, 'class'));

/** Markdown for a <ul>/<ol>. Lists nested as siblings of <li> (what Chrome's indent produces) belong to the item before. */
function list(node) {
  const ordered = node.nodeName === 'OL';
  const checklist = !ordered && isChecklist(node);
  let n = Number.parseInt(attr(node, 'start'), 10);
  if (!Number.isFinite(n)) n = 1;
  const items = [];
  for (const child of children(node)) {
    if (child.nodeType !== ELEMENT) {
      if (textOf(child).trim()) items.push({ marker: ordered ? `${n++}. ` : '- ', body: paragraph(inlineNode(child)) });
      continue;
    }
    if (child.nodeName === 'UL' || child.nodeName === 'OL') {
      const nested = list(child);
      if (!nested) continue;
      if (items.length) items[items.length - 1].body += `\n${nested}`;
      else items.push({ marker: '', body: nested });
      continue;
    }
    let marker = ordered ? `${n++}. ` : '- ';
    if (checklist) marker += attr(child, 'data-checked') === 'true' ? '[x] ' : '[ ] ';
    items.push({ marker, body: blocks(children(child)).join('\n') });
  }
  return items
    .map(({ marker, body }) => {
      const indent = ' '.repeat(ordered ? marker.length : 2);
      const [first = '', ...rest] = body.split('\n');
      return [marker + first, ...rest.map((l) => (l ? indent + l : l))].join('\n').trimEnd();
    })
    .join('\n');
}

/** Block-level Markdown for a sequence of nodes; loose inline content becomes paragraphs. */
function blocks(nodes) {
  const out = [];
  let run = [];
  let lastQuote = -1;
  const flush = () => {
    const p = paragraph(inline(run));
    if (p) out.push(p);
    run = [];
  };
  for (const node of nodes) {
    const name = node.nodeType === ELEMENT ? node.nodeName : '';
    if (!BLOCK.has(name)) {
      run.push(node);
      continue;
    }
    flush();
    if (/^H[1-6]$/.test(name)) {
      const text = inline(children(node)).split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
      if (text) out.push(`${'#'.repeat(Number(name[1]))} ${text}`);
    } else if (name === 'UL' || name === 'OL') {
      const md = list(node);
      if (md) out.push(md);
    } else if (name === 'BLOCKQUOTE') {
      const md = blocks(children(node)).join('\n\n');
      if (!md) continue;
      const quoted = md.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
      // Chrome makes one <blockquote> per line; consecutive ones read as one quote.
      if (lastQuote >= 0 && lastQuote === out.length - 1) out[lastQuote] += `\n>\n${quoted}`;
      else out.push(quoted);
      lastQuote = out.length - 1;
    } else if (name === 'PRE') {
      const code = textOf(node).replace(/\u200b/g, '').replace(/\u00a0/g, ' ').replace(/^\n|\n$/g, '');
      if (code.trim()) {
        const fence = '`'.repeat(Math.max(3, ...(code.match(/`{3,}/g) || ['']).map((t) => t.length + 1)));
        out.push(`${fence}\n${code}\n${fence}`);
      }
    } else if (name === 'HR') {
      out.push('---');
    } else {
      out.push(...blocks(children(node)));
    }
  }
  flush();
  return out;
}

/** Markdown for the editor's content (`root`'s children). Empty editor → ''. */
export function toMarkdown(root) {
  return blocks(children(root)).join('\n\n').trim();
}

// ---------------------------------------------------------------------------
// Pasted HTML → editor HTML
// ---------------------------------------------------------------------------

const KEEP = {
  P: 'P', DIV: 'P', SECTION: 'P', ARTICLE: 'P', HEADER: 'P', FOOTER: 'P', MAIN: 'P', ASIDE: 'P', FIGURE: 'P', TR: 'P', DT: 'P', DD: 'P',
  H1: 'H1', H2: 'H2', H3: 'H3', H4: 'H3', H5: 'H3', H6: 'H3',
  UL: 'UL', OL: 'OL', LI: 'LI', BLOCKQUOTE: 'BLOCKQUOTE', PRE: 'PRE', HR: 'HR', BR: 'BR',
  CODE: 'CODE', KBD: 'CODE', SAMP: 'CODE', A: 'A',
};
const MARK_TAG = { b: 'B', i: 'I', s: 'S' };

/**
 * Copies `src`'s children into `dest` (created with `doc`), keeping only what the editor supports:
 * headings, paragraphs, lists (incl. checklists), quotes, code, links, rules, bold/italic/strike.
 * Everything else is unwrapped to its text; scripts, styles, media and form controls are dropped.
 */
export function sanitizeTree(src, dest, doc) {
  for (const node of children(src)) {
    if (node.nodeType === TEXT) {
      if (node.nodeValue) dest.appendChild(doc.createTextNode(node.nodeValue));
      continue;
    }
    if (node.nodeType !== ELEMENT || DROP.has(node.nodeName)) continue;

    const mark = markOf(node);
    const tag = mark ? MARK_TAG[mark] : KEEP[node.nodeName];
    if (!tag) {
      sanitizeTree(node, dest, doc);
      if (node.nodeName === 'TD' || node.nodeName === 'TH') dest.appendChild(doc.createTextNode(' '));
      continue;
    }
    const out = doc.createElement(tag);
    if (tag === 'A') {
      const href = safeHref(attr(node, 'href'));
      if (!href) {
        sanitizeTree(node, dest, doc);
        continue;
      }
      out.setAttribute('href', href);
    } else if (tag === 'OL' && attr(node, 'start')) {
      out.setAttribute('start', attr(node, 'start'));
    } else if (tag === 'UL' && (isChecklist(node) || children(node).some((li) => checkboxOf(li)))) {
      out.setAttribute('class', 'checklist');
    } else if (tag === 'LI') {
      const box = checkboxOf(node);
      const checked = attr(node, 'data-checked') === 'true' || (box && (box.checked === true || !!box.hasAttribute?.('checked')));
      if (checked) out.setAttribute('data-checked', 'true');
    }
    if (tag === 'PRE' || tag === 'CODE') out.appendChild(doc.createTextNode(textOf(node)));
    else if (tag !== 'HR' && tag !== 'BR') sanitizeTree(node, out, doc);
    dest.appendChild(out);
  }
  return dest;
}

/** The checkbox at the start of a pasted task-list item (GitHub, Notion, …), if any. */
function checkboxOf(li) {
  if (li.nodeType !== ELEMENT || li.nodeName !== 'LI') return null;
  for (const child of children(li)) {
    if (child.nodeType === TEXT && !child.nodeValue.trim()) continue;
    if (child.nodeType === ELEMENT && child.nodeName === 'INPUT' && attr(child, 'type') === 'checkbox') return child;
    if (child.nodeType === ELEMENT && child.nodeName === 'P') return checkboxOf({ nodeType: ELEMENT, nodeName: 'LI', childNodes: child.childNodes });
    return null;
  }
  return null;
}
