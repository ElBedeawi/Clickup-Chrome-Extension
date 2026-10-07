import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installChrome, mockFetch } from '../helpers/chrome-stub.mjs';
import * as api from '../../lib/clickup-api.js';

describe('parseTaskRef', () => {
  const cases = [
    ['https://app.clickup.com/t/86abc123', { taskId: '86abc123', customTaskIds: false }],
    ['https://app.clickup.com/t/86abc123?comment=1', { taskId: '86abc123', customTaskIds: false }],
    ['https://app.clickup.com/t/9012345/DEV-123', { taskId: 'DEV-123', customTaskIds: true, teamId: '9012345' }],
    // A native ID behind a team prefix must not be treated as a custom ID.
    ['https://app.clickup.com/t/9012345/86abc123', { taskId: '86abc123', customTaskIds: false, teamId: '9012345' }],
    ['86abc123', { taskId: '86abc123', customTaskIds: false }],
    ['#86abc123', { taskId: '86abc123', customTaskIds: false }],
    ['  DEV-123  ', { taskId: 'DEV-123', customTaskIds: true }],
  ];
  for (const [input, expected] of cases) {
    test(`parses ${JSON.stringify(input)}`, () => assert.deepEqual(api.parseTaskRef(input), expected));
  }

  for (const input of ['', '   ', 'bad id!', 'https://google.com/t/abc', 'https://app.clickup.com/9012/v/l/6', 'https://app.clickup.com/t/']) {
    test(`rejects ${JSON.stringify(input)}`, () => assert.equal(api.parseTaskRef(input), null));
  }
});

describe('retryDelayMs', () => {
  const headers = (h) => (name) => h[name] ?? null;

  test('uses Retry-After seconds', () => {
    assert.equal(api.retryDelayMs(headers({ 'Retry-After': '3' }), 0), 3000);
  });

  test('waits until X-RateLimit-Reset (+500ms margin)', () => {
    const reset = Math.floor(Date.now() / 1000) + 10;
    const ms = api.retryDelayMs(headers({ 'X-RateLimit-Reset': String(reset) }), 0);
    assert.ok(ms > 8_000 && ms <= 11_000, `got ${ms}`);
  });

  test('falls back to exponential backoff', () => {
    assert.deepEqual([0, 1, 2].map((a) => api.retryDelayMs(headers({}), a)), [1000, 2000, 4000]);
  });

  test('never waits more than a minute', () => {
    assert.equal(api.retryDelayMs(headers({ 'Retry-After': '3600' }), 0), 60_000);
    assert.equal(api.retryDelayMs(headers({}), 10), 60_000);
  });
});

describe('requests', () => {
  beforeEach(() => installChrome({ clickupToken: 'pk_test_token' }));

  test('sends the personal token as-is (no "Bearer")', async () => {
    const calls = mockFetch([{ body: { user: { id: 1, username: 'Sara' } } }]);
    const user = await api.getUser();
    assert.equal(user.username, 'Sara');
    assert.equal(calls[0].url, 'https://api.clickup.com/api/v2/user');
    assert.equal(calls[0].headers.Authorization, 'pk_test_token');
  });

  test('fails clearly when no token is saved', async () => {
    installChrome({});
    await assert.rejects(api.getUser(), /No ClickUp API token/);
  });

  test('maps 401 to an actionable message', async () => {
    mockFetch([{ status: 401, body: { err: 'Token invalid', ECODE: 'OAUTH_025' } }]);
    await assert.rejects(api.getUser(), (err) => err.status === 401 && /Invalid or expired API token/.test(err.message));
  });

  test('maps out-of-storage to a readable error', async () => {
    mockFetch([{ status: 400, body: { err: 'x', ECODE: 'GBUSED_005' } }]);
    await assert.rejects(api.getUser(), /out of storage/);
  });

  test('retries a 429 and then succeeds', async () => {
    const calls = mockFetch([
      { status: 429, headers: { 'Retry-After': '0.01' } },
      { body: { teams: [{ id: '1', name: 'Acme' }] } },
    ]);
    const teams = await api.getWorkspaces();
    assert.equal(calls.length, 2);
    assert.equal(teams[0].name, 'Acme');
  });

  test('gives up after 3 retries', async () => {
    const calls = mockFetch(Array.from({ length: 5 }, () => ({ status: 429, headers: { 'Retry-After': '0.01' } })));
    await assert.rejects(api.getWorkspaces(), (err) => err.status === 429);
    assert.equal(calls.length, 4); // first try + 3 retries
  });

  test('hierarchy calls exclude archived items', async () => {
    const calls = mockFetch([{ body: { spaces: [] } }]);
    await api.getSpaces('42');
    assert.equal(calls[0].url, 'https://api.clickup.com/api/v2/team/42/space?archived=false');
  });

  test('custom task IDs add custom_task_ids and team_id', async () => {
    const calls = mockFetch([{ body: { id: 'abc' } }]);
    await api.getTask('DEV-123', { customTaskIds: true, teamId: '9012' });
    assert.equal(calls[0].url, 'https://api.clickup.com/api/v2/task/DEV-123?custom_task_ids=true&team_id=9012');
  });
});

describe('createTask', () => {
  beforeEach(() => installChrome({ clickupToken: 'pk_test_token' }));

  test('sends only the fields that are set', async () => {
    const calls = mockFetch([{ body: { id: 't1' } }]);
    await api.createTask('1000', {
      name: 'Bug',
      markdown_description: '',
      status: undefined,
      priority: undefined,
      assignees: [],
      tags: [],
      custom_fields: [],
    });
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, 'https://api.clickup.com/api/v2/list/1000/task');
    assert.deepEqual(JSON.parse(calls[0].body), { name: 'Bug' });
  });

  test('includes details, due date and custom fields', async () => {
    const calls = mockFetch([{ body: { id: 't1' } }]);
    await api.createTask('1000', {
      name: 'Bug',
      markdown_description: 'Steps',
      status: 'to do',
      priority: 2,
      assignees: [11, 13],
      tags: ['checkout'],
      due_date: 1_791_000_000_000,
      due_date_time: false,
      custom_fields: [{ id: 'f1', value: 'o1' }],
    });
    assert.deepEqual(JSON.parse(calls[0].body), {
      name: 'Bug',
      markdown_description: 'Steps',
      status: 'to do',
      priority: 2,
      assignees: [11, 13],
      tags: ['checkout'],
      due_date: 1_791_000_000_000,
      due_date_time: false,
      custom_fields: [{ id: 'f1', value: 'o1' }],
    });
  });

  test('comments never notify everyone', async () => {
    const calls = mockFetch([{ body: { id: 'c1' } }]);
    await api.createTaskComment('t1', 'See video');
    assert.deepEqual(JSON.parse(calls[0].body), { comment_text: 'See video', notify_all: false });
  });
});
