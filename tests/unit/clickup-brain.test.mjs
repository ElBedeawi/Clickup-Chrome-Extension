import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  brainQuery,
  textToOps,
  questionBody,
  findBrainRoomId,
  pickReply,
  progressText,
  conversationUrl,
  brainError,
  findBrainRoom,
  postQuestion,
  waitForReply,
} from '../../lib/clickup-brain.js';
import { renderOps, opsToLines } from '../../lib/quill-render.js';

// Shapes below are trimmed from ClickUp's real responses (captured 2026-10-29).
const ROOMS = {
  rooms: [
    { status: 'found', data: { id: 'hqy3c-18675', type: 'DM', members: ['-34671106', '1'] } },
    { status: 'found', data: { id: 'hqy3c-29435', type: 'ASK_AI', members: ['-4', '1'] } },
  ],
};
const aiReply = (trigger, extra = {}) => ({
  data: {
    id: '80150091826880',
    userid: -4,
    comment_type: 'ai',
    text_content: '123p6dmcj20 is a research spike.\n',
    comment: [
      { type: 'task_mention', task_mention: { task_id: '123p6dmcj20', team_id: '18610284' }, text: '123p6dmcj20' },
      { text: ' is a research spike.', attributes: {} },
      { text: '\n', attributes: { 'block-id': 'block-1' } },
    ],
    extra: { model: 'auto', triggered_on: { externalID: `comment:${trigger}` }, conversation_id: '7024363598439061032', ...extra },
  },
});

describe('pure helpers', () => {
  test('brainQuery carries Brain options, and a task natively when given', () => {
    assert.equal(brainQuery(), '/?shouldTriage=false&createLink=false&selectedModel=auto');
    const q = new URLSearchParams(brainQuery({ taskId: '123p6dmcj20' }).slice(2));
    assert.equal(q.get('ancestor'), 'task:123p6dmcj20');
    assert.equal(q.get('uiContext'), 'task:123p6dmcj20');
    assert.deepEqual(JSON.parse(q.get('selectedItem')), { kind: 'location', context: 'task', contextId: '123p6dmcj20' });
  });

  test('textToOps makes one text and one newline op per line', () => {
    assert.deepEqual(textToOps('hi'), [{ text: 'hi', attributes: {} }, { text: '\n', attributes: {} }]);
    assert.deepEqual(textToOps('a\r\n\nb').map((o) => o.text), ['a', '\n', '\n', 'b', '\n']);
  });

  test('questionBody: a new chat goes to the room, a follow-up to the thread', () => {
    const first = questionBody({ text: 'Q', roomId: 'r1', id: 'u1', now: 5 });
    assert.equal(first.parent, 'r1');
    assert.equal(first.type, 8);
    assert.equal(first.key, '8_r1');
    assert.equal(first.root_parent_id, 'r1');
    assert.equal(first.date, '5');
    const next = questionBody({ text: 'Q2', roomId: 'r1', threadId: '801', taskId: 't9', id: 'u2', now: 6 });
    assert.equal(next.parent, '801');
    assert.equal(next.type, 2);
    assert.equal(next.key, '2_801');
    assert.equal(next.root_parent_id, 'r1');
    assert.match(next.comment_type_data.query, /selectedItem=/);
  });

  test('findBrainRoomId picks the ASK_AI room', () => {
    assert.equal(findBrainRoomId(ROOMS), 'hqy3c-29435');
    assert.equal(findBrainRoomId({ rooms: [ROOMS.rooms[0]] }), null);
    assert.equal(findBrainRoomId(null), null);
  });

  test('pickReply finds the answer to this question only', () => {
    const json = { comments: [aiReply('111'), { data: { id: '222', userid: 5, text_content: 'my follow-up' } }] };
    const reply = pickReply(json, '111');
    assert.equal(reply.text, '123p6dmcj20 is a research spike.\n');
    assert.equal(reply.conversationId, '7024363598439061032');
    assert.equal(reply.ops.length, 3);
    assert.equal(pickReply(json, '222'), null); // the follow-up isn't answered yet
    assert.equal(pickReply({ comments: [] }, '111'), null);
  });

  test('progressText reads the latest step Brain logged on the question', () => {
    const json = {
      comments: [
        {
          data: {
            id: '111',
            extra: { interaction_log: { '-4': [{ displayText: 'Reading the task' }, { displayText: 'Checking the spike details' }, { displayText: '', displayType: 'progress' }] } },
          },
        },
      ],
    };
    assert.equal(progressText(json, '111'), 'Checking the spike details');
    assert.equal(progressText(json, '999'), '');
    assert.equal(progressText(null, '111'), '');
  });

  test('conversationUrl opens the chat in ClickUp', () => {
    assert.equal(conversationUrl('42', '70'), 'https://app.clickup.com/42/ai/brain?conversationId=70');
  });

  test('brainError turns failures into actionable messages', () => {
    assert.match(brainError(401, {}).message, /Sign in to ClickUp/);
    assert.match(brainError(400, { ECODE: 'JWT_015' }).message, /Sign in to ClickUp/);
    assert.match(brainError(403, {}).message, /isn't available/);
    assert.match(brainError(429, {}).message, /busy/);
    assert.equal(brainError(500, { err: 'boom' }).message, 'boom');
    assert.equal(brainError(502, null).message, "ClickUp Brain didn't answer (HTTP 502).");
    assert.equal(brainError(401, {}).status, 401);
  });
});

describe('networking', () => {
  const session = { token: 'tok', base: 'https://frontdoor-x.clickup.com', workspaceId: '42' };
  const respond = (status, json) => ({ ok: status < 300, status, json: async () => json });

  test('findBrainRoom sends the Bearer token and explains a missing room', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, init });
      return respond(200, ROOMS);
    };
    assert.equal(await findBrainRoom(session, { fetchImpl }), 'hqy3c-29435');
    assert.equal(seen[0].url, 'https://frontdoor-x.clickup.com/chat/v1/workspaces/42/chat/rooms/delta/0?fields=members');
    assert.equal(seen[0].init.headers.Authorization, 'Bearer tok');
    assert.equal(seen[0].init.credentials, 'omit');
    await assert.rejects(findBrainRoom(session, { fetchImpl: async () => respond(200, { rooms: [] }) }), /Open ClickUp Brain once/);
    await assert.rejects(findBrainRoom(session, { fetchImpl: async () => respond(401, {}) }), /Sign in/);
  });

  test('postQuestion posts a new chat to the room and a follow-up to the thread', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, body: JSON.parse(init.body), key: init.headers['Idempotency-Key'] });
      return respond(201, { id: 80150091825198 });
    };
    assert.equal(await postQuestion(session, { roomId: 'r1', text: 'Hi' }, { fetchImpl }), '80150091825198');
    assert.equal(seen[0].url, 'https://frontdoor-x.clickup.com/comment-service/v3/workspaces/42/comments/view/r1');
    assert.equal(seen[0].key, seen[0].body.id);
    await postQuestion(session, { roomId: 'r1', threadId: '801', text: 'More?' }, { fetchImpl });
    assert.equal(seen[1].url, 'https://frontdoor-x.clickup.com/comment-service/v3/workspaces/42/comments/comment/801');
    assert.equal(seen[1].body.parent, '801');
  });

  test('waitForReply polls the thread, reports progress, and returns the answer', async () => {
    let polls = 0;
    const progress = [];
    const fetchImpl = async (url) => {
      if (url.includes('/comments/bulk')) {
        return respond(200, { comments: [{ data: { id: '111', extra: { interaction_log: { '-4': [{ displayText: 'Thinking' }] } } } }] });
      }
      polls++;
      return respond(200, { comments: polls < 3 ? [] : [aiReply('111')] });
    };
    const reply = await waitForReply(session, { threadId: '111', invokeId: '111', onProgress: (t) => progress.push(t), intervalMs: 1, fetchImpl });
    assert.equal(reply.conversationId, '7024363598439061032');
    assert.equal(polls, 3);
    assert.deepEqual(progress, ['Thinking']);
  });

  test('waitForReply stops on abort and gives up after its timeout', async () => {
    const empty = async () => respond(200, { comments: [] });
    const ctl = new AbortController();
    const p = waitForReply(session, { threadId: '1', invokeId: '1', signal: ctl.signal, intervalMs: 50, fetchImpl: empty });
    setTimeout(() => ctl.abort(), 5);
    await assert.rejects(p, { name: 'AbortError' });
    await assert.rejects(waitForReply(session, { threadId: '1', invokeId: '1', intervalMs: 1, timeoutMs: 0, fetchImpl: empty }), /taking a long time/);
  });
});

// --- rendering ---------------------------------------------------------------------------------

class Text {
  constructor(value) {
    this.nodeType = 3;
    this.nodeValue = value;
    this.childNodes = [];
  }
}
class Element {
  constructor(name) {
    this.nodeType = 1;
    this.nodeName = name.toUpperCase();
    this.attrs = {};
    this.childNodes = [];
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
function html(node) {
  if (node.nodeType === 3) return node.nodeValue;
  const tag = node.nodeName.toLowerCase();
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
  return `<${tag}${attrs}>${node.childNodes.map(html).join('')}</${tag}>`;
}
const render = (ops, opts) => html(renderOps(ops, doc, opts)).replace(/^<div>|<\/div>$/g, '');

describe('renderOps', () => {
  test('paragraphs, inline formats and a real task-mention reply', () => {
    assert.equal(
      render(aiReply('1').data.comment),
      '<p><a href="https://app.clickup.com/t/18610284/123p6dmcj20" target="_blank" rel="noopener noreferrer" class="mention" data-task-id="123p6dmcj20">123p6dmcj20</a> is a research spike.</p>',
    );
    assert.equal(
      render([{ text: 'Also ' }, { text: 'SSO', attributes: { bold: true } }, { text: ' and ' }, { text: 'x', attributes: { italic: true, code: true } }, { text: '\n' }]),
      '<p>Also <strong>SSO</strong> and <em><code>x</code></em></p>',
    );
  });

  test('empty lines are dropped; a trailing line without newline still renders', () => {
    assert.equal(render([{ text: 'a\n\n\nb' }]), '<p>a</p><p>b</p>');
  });

  test('lists group consecutive lines; code blocks join their lines; headers and quotes', () => {
    const ops = [
      { text: 'Steps' },
      { text: '\n', attributes: { header: 2 } },
      { text: 'one' },
      { text: '\n', attributes: { list: 'bullet' } },
      { text: 'two' },
      { text: '\n', attributes: { list: 'bullet' } },
      { text: 'first' },
      { text: '\n', attributes: { list: 'ordered' } },
      { text: 'let a = 1;' },
      { text: '\n', attributes: { 'code-block': true } },
      { text: 'a++;' },
      { text: '\n', attributes: { 'code-block': true } },
      { text: 'quoted' },
      { text: '\n', attributes: { blockquote: true } },
      { text: 'done' },
      { text: '\n', attributes: { list: 'checked' } },
    ];
    assert.equal(
      render(ops),
      '<h4>Steps</h4><ul><li>one</li><li>two</li></ul><ol><li>first</li></ol><pre>let a = 1;\na++;</pre>' +
        '<blockquote>quoted</blockquote><ul><li data-checked="true">done</li></ul>',
    );
  });

  test('untrusted input: unsafe links lose their href, markup stays text', () => {
    assert.equal(render([{ text: 'x', attributes: { link: 'javascript:alert(1)' } }, { text: '\n' }]), '<p>x</p>');
    assert.equal(
      render([{ text: 'site', attributes: { link: 'https://example.com' } }, { text: '\n' }]),
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a></p>',
    );
    const out = renderOps([{ text: '<img src=x onerror=alert(1)>\n' }], doc);
    assert.equal(out.childNodes[0].childNodes[0].nodeType, 3); // a text node, not markup
    assert.equal(render([{ type: 'task_mention', task_mention: { task_id: '"><x' }, text: 't' }, { text: '\n' }]), '<p>t</p>');
  });

  test('task mentions without a team id use the workspace; unknown ops and non-arrays are ignored', () => {
    assert.equal(
      render([{ type: 'task_mention', task_mention: { task_id: 'abc' }, text: 'abc' }, { text: '\n' }], { workspaceId: '42' }),
      '<p><a href="https://app.clickup.com/t/42/abc" target="_blank" rel="noopener noreferrer" class="mention" data-task-id="abc">abc</a></p>',
    );
    assert.equal(render([{ type: 'image', image: {} }, { insert: 'std quill\n' }]), '<p>std quill</p>');
    assert.equal(render(null), '');
    assert.equal(opsToLines([{ text: 'a\nb' }]).length, 2);
  });
});
