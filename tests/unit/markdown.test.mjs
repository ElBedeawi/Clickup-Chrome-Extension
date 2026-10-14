import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown, sanitizeTree, safeHref } from '../../lib/markdown.js';

// Just enough DOM for lib/markdown.js: element(name, attrs?, ...children), strings become text nodes.
class Text {
  constructor(value) {
    this.nodeType = 3;
    this.nodeName = '#text';
    this.nodeValue = value;
    this.childNodes = [];
  }
}
class Element {
  constructor(name, attrs = {}) {
    this.nodeType = 1;
    this.nodeName = name.toUpperCase();
    this.attrs = { ...attrs };
    this.childNodes = [];
  }
  getAttribute(name) {
    return name in this.attrs ? this.attrs[name] : null;
  }
  hasAttribute(name) {
    return name in this.attrs;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  appendChild(node) {
    this.childNodes.push(node);
    return node;
  }
}
const doc = { createElement: (n) => new Element(n), createTextNode: (v) => new Text(v) };

function h(name, ...rest) {
  const attrs = rest[0] && typeof rest[0] === 'object' && !(rest[0] instanceof Element) && !(rest[0] instanceof Text) ? rest.shift() : {};
  const el = new Element(name, attrs);
  for (const kid of rest.flat()) el.appendChild(typeof kid === 'string' ? new Text(kid) : kid);
  return el;
}
const md = (...kids) => toMarkdown(h('div', ...kids));

/** Serialises a fake tree back to HTML, to check sanitizeTree's output. */
function html(node) {
  if (node.nodeType === 3) return node.nodeValue;
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
  const inner = node.childNodes.map(html).join('');
  return node.nodeName === 'ROOT' ? inner : `<${node.nodeName.toLowerCase()}${attrs}>${inner}</${node.nodeName.toLowerCase()}>`;
}
const clean = (...kids) => html(sanitizeTree(h('div', ...kids), new Element('root'), doc));

describe('toMarkdown', () => {
  test('empty editor gives an empty string', () => {
    assert.equal(md(), '');
    assert.equal(md(h('p', h('br'))), '');
    assert.equal(md(h('p', '\u200b ')), '');
  });

  test('paragraphs, line breaks and loose text', () => {
    assert.equal(md('First line', h('p', 'Second', h('br'), 'third')), 'First line\n\nSecond\nthird');
    assert.equal(md(h('div', 'a'), h('div', 'b')), 'a\n\nb'); // Chrome without a paragraph separator
  });

  test('bold, italic, strikethrough and inline code', () => {
    assert.equal(md(h('p', 'The ', h('b', 'Pay'), ' button ', h('i', 'slides'), ' ', h('s', 'over'), ' ', h('code', 'x < y'))), 'The **Pay** button *slides* ~~over~~ `x < y`');
    assert.equal(md(h('p', h('strong', h('em', 'both')))), '***both***');
  });

  test('keeps spaces outside the markers', () => {
    assert.equal(md(h('p', 'a', h('b', ' bold '), 'b')), 'a **bold** b');
    assert.equal(md(h('p', h('b', ' '))), '');
  });

  test('merges adjacent siblings with the same mark', () => {
    assert.equal(md(h('p', h('b', 'a'), h('strong', 'b'))), '**ab**');
  });

  test('reads bold/italic/strike from inline styles (Chrome-merged or pasted spans)', () => {
    assert.equal(md(h('p', h('span', { style: 'font-weight: 700;' }, 'b'), ' ', h('span', { style: 'font-style: italic' }, 'i'), ' ', h('span', { style: 'text-decoration: line-through' }, 's'))), '**b** *i* ~~s~~');
    assert.equal(md(h('p', h('b', { style: 'font-weight:normal;' }, 'plain'))), 'plain'); // Google Docs wrapper
  });

  test('inline code containing backticks', () => {
    assert.equal(md(h('p', h('code', 'a`b'))), '``a`b``');
    assert.equal(md(h('p', h('code', '`x'))), '`` `x ``');
  });

  test('links: safe hrefs only', () => {
    assert.equal(md(h('p', h('a', { href: 'https://example.com/a b(1)' }, 'site'))), '[site](https://example.com/a%20b%281%29)');
    assert.equal(md(h('p', h('a', { href: 'javascript:alert(1)' }, 'bad'))), 'bad');
    assert.equal(md(h('p', h('a', { href: 'mailto:a@b.co' }, h('b', 'mail')))), '[**mail**](mailto:a@b.co)');
  });

  test('headings', () => {
    assert.equal(md(h('h1', 'Title'), h('h2', 'Sub ', h('b', 'bold')), h('h3', 'Small')), '# Title\n\n## Sub **bold**\n\n### Small');
    assert.equal(md(h('h2', h('br'))), '');
  });

  test('bulleted and numbered lists', () => {
    assert.equal(md(h('ul', h('li', 'one'), h('li', 'two'))), '- one\n- two');
    assert.equal(md(h('ol', h('li', 'one'), h('li', 'two'))), '1. one\n2. two');
    assert.equal(md(h('ol', { start: '4' }, h('li', 'four'))), '4. four');
  });

  test('nested lists, inside the item and as siblings (Chrome indent)', () => {
    assert.equal(md(h('ul', h('li', 'a', h('ul', h('li', 'b'))), h('li', 'c'))), '- a\n  - b\n- c');
    assert.equal(md(h('ol', h('li', 'a'), h('ol', h('li', 'b')), h('li', 'c'))), '1. a\n   1. b\n2. c');
  });

  test('checklists', () => {
    assert.equal(
      md(h('ul', { class: 'checklist' }, h('li', { 'data-checked': 'true' }, 'done'), h('li', 'todo'))),
      '- [x] done\n- [ ] todo',
    );
  });

  test('quotes, code blocks and dividers', () => {
    assert.equal(md(h('blockquote', h('p', 'a'), h('p', 'b'))), '> a\n>\n> b');
    assert.equal(md(h('blockquote', 'a'), h('blockquote', 'b'), h('p', 'c'), h('blockquote', 'd')), '> a\n>\n> b\n\nc\n\n> d'); // Chrome: one per line
    assert.equal(md(h('pre', 'const a = 1;\n  b *= 2;')), '```\nconst a = 1;\n  b *= 2;\n```');
    assert.equal(md(h('pre', 'has ```')), '````\nhas ```\n````');
    assert.equal(md(h('p', 'above'), h('hr'), h('p', 'below')), 'above\n\n---\n\nbelow');
  });

  test('escapes Markdown characters in text', () => {
    assert.equal(md(h('p', 'a*b_c [x] `y` ~z\\ <tag>')), 'a\\*b\\_c \\[x\\] \\`y\\` \\~z\\\\ \\<tag>');
  });

  test('escapes text that would start a block', () => {
    assert.equal(md(h('p', '# not a heading')), '\\# not a heading');
    assert.equal(md(h('p', '- not a list', h('br'), '1. nor this', h('br'), '> nor a quote')), '\\- not a list\n1\\. nor this\n\\> nor a quote');
    assert.equal(md(h('p', 'line', h('br'), '---')), 'line\n\\---');
    assert.equal(md(h('p', '#hashtag -5 1.5x')), '#hashtag -5 1.5x');
  });

  test('collapses whitespace and non-breaking spaces outside code blocks', () => {
    assert.equal(md(h('p', '  a \u00a0\u00a0b\n c ')), 'a b c');
  });

  test('the demo description', () => {
    assert.equal(
      md(h('p', 'Steps:'), h('ol', h('li', 'Add any item to the cart'), h('li', 'Open checkout')), h('p', 'The ', h('b', 'Pay'), ' button slides over the summary card.')),
      'Steps:\n\n1. Add any item to the cart\n2. Open checkout\n\nThe **Pay** button slides over the summary card.',
    );
  });
});

describe('sanitizeTree (paste)', () => {
  test('keeps supported formatting, unwraps the rest', () => {
    assert.equal(
      clean(h('div', { style: 'color:red' }, h('span', 'plain '), h('strong', 'bold'), h('u', ' under'))),
      '<p>plain <b>bold</b> under</p>',
    );
    assert.equal(clean(h('h5', 'deep')), '<h3>deep</h3>');
    assert.equal(clean(h('span', { style: 'font-weight:700' }, 'docs bold')), '<b>docs bold</b>');
  });

  test('drops scripts, styles, media and unsafe links', () => {
    assert.equal(clean(h('script', 'alert(1)'), h('style', 'p{}'), h('img', { src: 'x' }), 'text'), 'text');
    assert.equal(clean(h('a', { href: 'javascript:alert(1)', onclick: 'x' }, 'link')), 'link');
    assert.equal(clean(h('a', { href: 'https://a.co', onclick: 'x' }, 'link')), '<a href="https://a.co">link</a>');
  });

  test('turns task-list checkboxes into a checklist', () => {
    assert.equal(
      clean(h('ul', h('li', h('input', { type: 'checkbox', checked: '' }), ' done'), h('li', h('input', { type: 'checkbox' }), ' todo'))),
      '<ul class="checklist"><li data-checked="true"> done</li><li> todo</li></ul>',
    );
  });

  test('code keeps its text only', () => {
    assert.equal(clean(h('pre', h('span', { class: 'kw' }, 'const'), ' a')), '<pre>const a</pre>');
  });
});

test('safeHref', () => {
  assert.equal(safeHref(' https://a.co '), 'https://a.co');
  assert.equal(safeHref('www.a.co'), 'https://www.a.co');
  assert.equal(safeHref('data:text/html,x'), '');
  assert.equal(safeHref('chrome-extension://abc/x'), '');
});
