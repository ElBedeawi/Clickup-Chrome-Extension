// Renders a ClickUp rich-text comment (Quill-style ops, as Brain answers come back) as DOM nodes.
// The ops are untrusted: everything is built with createElement/createTextNode (never innerHTML),
// only a few formats are kept, and links go through safeHref(). Pure: takes the document to build with.

import { safeHref } from './markdown.js';

const INLINE = [
  ['code', 'CODE'],
  ['bold', 'STRONG'],
  ['italic', 'EM'],
  ['underline', 'U'],
  ['strike', 'S'],
];

/** The text an op inserts (ClickUp uses `text`; standard Quill uses `insert`). */
function opText(op) {
  if (typeof op?.text === 'string') return op.text;
  if (typeof op?.insert === 'string') return op.insert;
  return '';
}

/** Task URL for a task mention (a skill's page for skills, custom type 5), or '' if it has no usable id. */
function taskUrl(mention, workspaceId) {
  const id = mention?.task_id;
  if (!id || !/^[\w-]+$/.test(String(id))) return '';
  const team = /^\d+$/.test(String(mention.team_id || '')) ? mention.team_id : /^\d+$/.test(String(workspaceId || '')) ? workspaceId : '';
  if (Number(mention.custom_type) === 5 && team) return `https://app.clickup.com/${team}/ai/skills/${id}`;
  return team ? `https://app.clickup.com/t/${team}/${id}` : `https://app.clickup.com/t/${id}`;
}

function link(doc, href, child) {
  const a = doc.createElement('A');
  a.setAttribute('href', href);
  a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener noreferrer');
  a.appendChild(child);
  return a;
}

/** One inline run of text with its formats. */
function inlineNode(doc, text, attrs, workspaceId, op) {
  if (op?.type === 'task_mention') {
    const href = taskUrl(op.task_mention, workspaceId);
    if (!href) return doc.createTextNode(text);
    // A chip; the panel swaps the id for the task's name (data-task-id) where it can.
    const a = link(doc, href, doc.createTextNode(text));
    a.setAttribute('class', 'mention');
    if (Number(op.task_mention.custom_type) !== 5) a.setAttribute('data-task-id', String(op.task_mention.task_id));
    return a;
  }
  let node = doc.createTextNode(text);
  for (const [key, tag] of INLINE) {
    if (!attrs?.[key]) continue;
    const wrap = doc.createElement(tag);
    wrap.appendChild(node);
    node = wrap;
  }
  const href = attrs?.link ? safeHref(attrs.link) : '';
  return href ? link(doc, href, node) : node;
}

/**
 * Splits ops into lines: { runs: [{ text, attrs, op }], block: attrs of the line's newline }.
 * @returns {{ runs: { text: string, attrs: object, op: object }[], block: object }[]}
 */
export function opsToLines(ops) {
  const lines = [];
  let runs = [];
  for (const op of Array.isArray(ops) ? ops : []) {
    const text = opText(op);
    if (!text) continue;
    const attrs = op.attributes || {};
    const parts = text.split('\n');
    parts.forEach((part, i) => {
      if (part) runs.push({ text: part, attrs, op });
      if (i < parts.length - 1) {
        lines.push({ runs, block: attrs });
        runs = [];
      }
    });
  }
  if (runs.length) lines.push({ runs, block: {} });
  return lines;
}

const listKind = (block) => {
  const l = block?.list;
  if (l === 'ordered') return 'OL';
  if (l === 'bullet' || l === 'checked' || l === 'unchecked') return 'UL';
  return null;
};

/**
 * Renders ops into a new <div> built with `doc`.
 * @param {object[]} ops
 * @param {Document} doc
 * @param {{ workspaceId?: string }} [opts]  for task-mention links without their own team id
 */
export function renderOps(ops, doc, { workspaceId } = {}) {
  const root = doc.createElement('div');
  let list = null; // current <ul>/<ol>
  let pre = null; // current code block

  for (const { runs, block } of opsToLines(ops)) {
    const fill = (node) => {
      for (const r of runs) node.appendChild(inlineNode(doc, r.text, r.attrs, workspaceId, r.op));
      return node;
    };
    const kind = listKind(block);
    if (!kind) list = null;
    if (!block['code-block']) pre = null;

    if (kind) {
      if (!list || list.nodeName !== kind) list = root.appendChild(doc.createElement(kind));
      const li = fill(doc.createElement('LI'));
      if (block.list === 'checked' || block.list === 'unchecked') li.setAttribute('data-checked', String(block.list === 'checked'));
      list.appendChild(li);
    } else if (block['code-block']) {
      if (!pre) {
        pre = root.appendChild(doc.createElement('PRE'));
      } else {
        pre.appendChild(doc.createTextNode('\n'));
      }
      pre.appendChild(doc.createTextNode(runs.map((r) => r.text).join('')));
    } else if (!runs.length) {
      continue; // empty line: paragraphs already have spacing
    } else if (block.header) {
      root.appendChild(fill(doc.createElement('H4')));
    } else if (block.blockquote) {
      root.appendChild(fill(doc.createElement('BLOCKQUOTE')));
    } else {
      root.appendChild(fill(doc.createElement('P')));
    }
  }
  return root;
}
