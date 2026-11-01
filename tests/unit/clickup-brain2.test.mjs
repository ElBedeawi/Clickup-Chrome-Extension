// The Brain² composer's data layer: models, context items, files, skills, live answers.
// Shapes are trimmed from ClickUp's real requests and responses (captured 2026-10-29).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  brainQuery,
  questionBody,
  questionTriggers,
  pickReply,
  parseModels,
  searchQ,
  parseSearch,
  brainFileRule,
  fileType,
  parseSkills,
  watchAnswer,
  DEFAULT_FILE_RULES,
} from '../../lib/clickup-brain.js';
import { renderOps } from '../../lib/quill-render.js';

const query = (q) => new URLSearchParams(q.slice(2));

describe('brainQuery', () => {
  test('a model other than Brain² goes with AIToolId=ASSISTANT and an optional effort', () => {
    assert.equal(brainQuery({ model: 'gpt-6.1-sol', reasoning: 'low' }), '/?shouldTriage=false&createLink=false&AIToolId=ASSISTANT&selectedModel=gpt-6.1-sol&selectedReasoningLevel=low');
    const auto = query(brainQuery({ model: 'claude-opus-5-5' }));
    assert.equal(auto.get('selectedReasoningLevel'), null); // "Auto" effort sends none
    assert.equal(query(brainQuery({ model: 'auto', reasoning: 'high' })).get('selectedModel'), 'auto');
    assert.equal(query(brainQuery({ model: 'auto', reasoning: 'high' })).get('AIToolId'), null);
  });

  test('Deep Research, files and several tasks/docs (one selectedItem each)', () => {
    const q = query(brainQuery({ deepResearch: true, attachmentIds: ['a.txt'], items: [{ kind: 'task', id: 't1' }, { kind: 'doc', id: 'hqy3c-6655' }] }));
    assert.equal(q.get('deepResearch'), 'true');
    assert.deepEqual(q.getAll('id'), ['attachment:a.txt']);
    assert.deepEqual(q.getAll('selectedItem').map((s) => JSON.parse(s)), [
      { kind: 'location', context: 'task', contextId: 't1' },
      { kind: 'location', context: 'doc', contextId: 'hqy3c-6655' },
    ]);
    assert.equal(q.get('ancestor'), null); // only for exactly one task
  });
});

describe('questionBody', () => {
  const att = { id: 'u1.txt', name: 'notes.txt', extension: 'txt', mimetype: 'text/plain', date: 5, url: 'https://t1.clickup-attachments.com/u1/notes.txt' };

  test('files first, then the skill, then the text, like ClickUp sends them', () => {
    const body = questionBody({ text: 'what is 2+2?', roomId: 'r1', id: 'x', now: 1, workspaceId: '42', attachments: [att], skill: { id: 'sk1', name: 'Test skill' } });
    assert.deepEqual(body.comment.map((o) => o.type || o.text), ['attachment', 'task_mention', ' what is 2+2?', '\n']);
    assert.deepEqual(body.comment[0].attachment, {
      id: 'u1.txt',
      name: 'notes.txt',
      title: 'notes.txt',
      type: 'text/plain',
      extension: 'txt',
      source: 1,
      mimetype: 'text/plain',
      date: 5,
      thumbnail_large: null,
      thumbnail_medium: null,
      thumbnail_small: null,
      url: 'https://t1.clickup-attachments.com/u1/notes.txt',
      uploaded: true,
    });
    assert.deepEqual(body.comment[1], { type: 'task_mention', attributes: {}, task_mention: { task_id: 'sk1', team_id: '42', custom_type: 5, name: 'Test skill' } });
    assert.deepEqual(body.attachment_ids, ['u1.txt']);
    assert.deepEqual(query(body.comment_type_data.query).getAll('id'), ['attachment:u1.txt']);
  });

  test('a plain question has no attachment_ids', () => {
    assert.equal('attachment_ids' in questionBody({ text: 'hi', roomId: 'r', id: 'x', now: 1 }), false);
  });
});

test('a question with a file is answered "on" the file: pickReply accepts its triggers', () => {
  const thread = { comments: [{ data: { id: 'r', userid: -4, text_content: 'BLUE HERON', comment: [], extra: { triggered_on: { externalID: 'attachment:u1.txt' } } } }] };
  assert.equal(pickReply(thread, '801'), null);
  assert.deepEqual(questionTriggers('801', ['u1.txt']), ['comment:801', 'attachment:u1.txt']);
  assert.equal(pickReply(thread, '801', questionTriggers('801', ['u1.txt'])).text, 'BLUE HERON');
});

test('parseModels keeps the chat models (brain + agent), Brain² first as "auto", by canonical id', () => {
  const data = {
    getAIModels: [
      { id: 'agent-v1-unified-gpt-6-astra', canonicalId: 'gpt-6-astra', type: 'agent', name: 'GPT-6 Astra', badge: 'New', canUse: true, reasoningLevels: [{ key: 'low', label: 'Low' }] },
      { id: 'brain', type: 'brain', name: 'Brain²', description: 'Uses latest Anthropic models', canUse: true, features: [{ name: 'attachments', config: { images: {} } }] },
      { id: 'gpt-6-astra', type: 'passthrough', name: 'GPT-6 Astra', isPremium: true },
      { id: 'gpt-image-2', type: 'image', name: 'GPT Image 2' },
      { id: 'agent-x', canonicalId: 'gpt-6-astra', type: 'agent', name: 'dup' },
      { id: 'agent-y', canonicalId: 'claude-opus-5', type: 'agent', name: 'Claude Opus 5', canUse: false, isPremium: true },
    ],
  };
  const models = parseModels(data);
  assert.deepEqual(models.map((m) => m.id), ['auto', 'gpt-6-astra', 'claude-opus-5']);
  assert.deepEqual(models[0].attachments, { images: {} });
  assert.deepEqual(models[1].reasoning, [{ key: 'low', label: 'Low' }]);
  assert.equal(models[1].badge, 'New');
  assert.equal(models[2].canUse, false);
  assert.equal(models[2].premium, true);
  assert.deepEqual(parseModels(null), []);
});

test('search: the q for tasks/docs and the parsed results', () => {
  assert.equal(searchQ('Spike', 'task'), '/?keywords=Spike&app=clickupunified&assetType=task');
  assert.equal(searchQ('  ', 'doc'), '/?app=clickupunified&assetType=document&sort=-user_recents');
  const updates = [
    { result: { items: [{ ent: { externalID: 'task:123p6dmcj20', title: '[Spike] SSO', url: 'https://app.clickup.com/t/1/123p6dmcj20', data: '{"status_raw":"to do","status_color":"#87909e"}' } }] } },
    {
      result: {
        items: [
          { ent: { externalID: 'task:123p6dmcj20', title: 'dup' } },
          { ent: { externalID: 'doc:hqy3c-6655', title: 'Planning notes', data: 'not json' } },
          { ent: { externalID: 'calendar:9', title: 'skip' } },
          { ent: { externalID: 'task:x', title: 'bad colour', data: '{"status_color":"red;}"}' } },
        ],
      },
    },
  ];
  assert.deepEqual(parseSearch(updates), [
    { kind: 'task', id: '123p6dmcj20', name: '[Spike] SSO', url: 'https://app.clickup.com/t/1/123p6dmcj20', status: 'to do', color: '#87909e' },
    { kind: 'doc', id: 'hqy3c-6655', name: 'Planning notes', url: '', status: '', color: '' },
    { kind: 'task', id: 'x', name: 'bad colour', url: '', status: '', color: '' },
  ]);
});

test('files Brain² takes, with its limits; types from the name when the browser gives none', () => {
  const f = (name, type, size) => ({ name, type, size });
  assert.equal(fileType(f('notes.md', '', 1)), 'text/markdown');
  assert.equal(fileType(f('x.bin', '', 1)), '');
  assert.deepEqual(brainFileRule(f('a.png', 'image/png', 1000)), { ok: true, mimetype: 'image/png' });
  assert.deepEqual(brainFileRule(f('a.md', '', 1000)), { ok: true, mimetype: 'text/markdown' });
  assert.match(brainFileRule(f('big.png', 'image/png', 30_000_000)).reason, /Images can be up to 21 MB/);
  assert.match(brainFileRule(f('big.pdf', 'application/pdf', 30_000_000)).reason, /up to 25 MB/);
  assert.match(brainFileRule(f('long.txt', 'text/plain', 200_000)).reason, /20000 characters/);
  assert.match(brainFileRule(f('clip.webm', 'video/webm', 10)).reason, /takes images/);
  assert.equal(brainFileRule(f('a.gif', 'image/gif', 10), { ...DEFAULT_FILE_RULES, images: { maxSizeBytes: 5, supportedMimeTypes: ['image/gif'] } }).ok, false);
});

test('parseSkills: public-API tasks of the skills list, sorted, with a one-line summary', () => {
  assert.deepEqual(
    parseSkills([
      { id: 'b', name: 'Test skill', text_content: 'Answer in one sentence.\nMore.' },
      { id: 'a', name: 'Bug triage', description: 'Severity and owner' },
      { id: 'z', name: 'Old', archived: true },
      { name: 'no id' },
    ]),
    [
      { id: 'a', name: 'Bug triage', summary: 'Severity and owner' },
      { id: 'b', name: 'Test skill', summary: 'Answer in one sentence.' },
    ],
  );
});

test('a skill mention links to its skill page, a task mention to the task', () => {
  const doc = {
    createElement: (n) => ({ nodeName: n.toUpperCase(), attrs: {}, childNodes: [], setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.childNodes.push(c); return c; } }),
    createTextNode: (v) => ({ nodeType: 3, nodeValue: v }),
  };
  const out = renderOps([{ type: 'task_mention', task_mention: { task_id: 'sk1', team_id: '42', custom_type: 5, name: 'Test skill' }, text: 'Test skill' }, { text: '\n' }], doc);
  const a = out.childNodes[0].childNodes[0];
  assert.equal(a.attrs.href, 'https://app.clickup.com/42/ai/skills/sk1');
  assert.equal(a.attrs.class, 'mention');
  assert.equal('data-task-id' in a.attrs, false);
});

describe('watchAnswer', () => {
  /** A fake gateway socket: records subscriptions and lets the test push updates. */
  function fakeSocket() {
    const subs = [];
    return {
      subs,
      async subscribe(query, variables, handlers) {
        const s = { query, variables, handlers, stopped: false };
        subs.push(s);
        return () => (s.stopped = true);
      },
    };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  test('finds the run for this question, streams its answer, finishes on COMPLETED', async () => {
    const socket = fakeSocket();
    const seen = [];
    const p = watchAnswer(socket, { roomId: 'r1', invokeId: '801', onText: (t) => seen.push(t) });
    await tick();
    assert.equal(socket.subs[0].variables.query, '/?id=view%3Ar1');
    socket.subs[0].handlers.next({ data: { activeAgentRuns: [{ conversationId: 'c0', invokeId: 'comment:700' }] } });
    socket.subs[0].handlers.next({ data: { activeAgentRuns: [{ conversationId: 'c1', invokeId: 'comment:801' }] } });
    await tick();
    assert.equal(socket.subs.length, 2);
    assert.deepEqual(socket.subs[1].variables, { conversationID: 'c1' });
    socket.subs[1].handlers.next({ data: { aiConversationStatus: { status: 'GENERATING', result: { answer: 'Re' } } } });
    socket.subs[1].handlers.next({ data: { aiConversationStatus: { status: 'COMPLETED', result: { answer: 'Red', answerComplete: true } } } });
    assert.deepEqual(await p, { conversationId: 'c1', text: 'Red' });
    assert.deepEqual(seen, ['Re', 'Red']);
    assert.ok(socket.subs.every((s) => s.stopped));
  });

  test('matches a question with files by its attachment trigger, and ends when the stream ends', async () => {
    const socket = fakeSocket();
    const p = watchAnswer(socket, { roomId: 'r1', invokeId: '801', triggers: questionTriggers('801', ['u1.txt']) });
    await tick();
    socket.subs[0].handlers.next({ data: { activeAgentRuns: [{ conversationId: 'c2', invokeId: 'attachment:u1.txt' }] } });
    await tick();
    socket.subs[1].handlers.next({ data: { aiConversationStatus: { status: 'GENERATING', result: { answer: 'BLUE' } } } });
    socket.subs[1].handlers.complete();
    assert.deepEqual(await p, { conversationId: 'c2', text: 'BLUE' });
  });

  test('stops on abort', async () => {
    const socket = fakeSocket();
    const ctl = new AbortController();
    const p = watchAnswer(socket, { roomId: 'r1', invokeId: '1', signal: ctl.signal });
    await tick();
    ctl.abort();
    await assert.rejects(p, { name: 'AbortError' });
    assert.ok(socket.subs[0].stopped);
  });
});
