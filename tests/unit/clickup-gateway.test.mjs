import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatewayOrigin, gatewaySocketUrl, getGateway, dropGateway, gql, createGatewaySocket, collect } from '../../lib/clickup-gateway.js';

const respond = (status, json) => ({ ok: status < 300, status, json: async () => json });

test('gatewayOrigin accepts only ClickUp hosts (the CSP allows *.clickup.com and *.clickup-eu.com)', () => {
  assert.equal(gatewayOrigin('https://frontdoor-search.clickup-eu.com'), 'https://frontdoor-search.clickup-eu.com');
  assert.equal(gatewayOrigin('https://search.clickup.com'), 'https://search.clickup.com');
  for (const bad of ['http://frontdoor-search.clickup-eu.com', 'https://clickup-eu.com.evil.io', 'https://evil.io/clickup.com', 'https://x.clickup-us.com', '', null]) {
    assert.equal(gatewayOrigin(bad), null, String(bad));
  }
  assert.equal(gatewaySocketUrl('https://frontdoor-search.clickup-eu.com'), 'wss://frontdoor-search.clickup-eu.com/graphql/gateway?c=gws-web-1');
});

test('getGateway asks the shard for a token and caches it until shortly before it expires', async () => {
  const session = { token: 'web', base: 'https://frontdoor-x.clickup.com', workspaceId: '42' };
  const calls = [];
  let clock = 1_000_000;
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    return respond(200, { origin: 'https://frontdoor-search.clickup-eu.com', accessToken: 'gw1', expiresIn: 480 });
  };
  const g = await getGateway(session, { fetchImpl, now: () => clock });
  assert.deepEqual(g, { origin: 'https://frontdoor-search.clickup-eu.com', accessToken: 'gw1' });
  assert.deepEqual(calls[0], { url: 'https://frontdoor-x.clickup.com/v2/sd/team/42/access-token', auth: 'Bearer web' });
  await getGateway(session, { fetchImpl, now: () => clock });
  assert.equal(calls.length, 1);
  clock += 460_000; // within 30 s of the 480 s expiry
  await getGateway(session, { fetchImpl, now: () => clock });
  assert.equal(calls.length, 2);
  dropGateway('42');
  await getGateway(session, { fetchImpl, now: () => clock });
  assert.equal(calls.length, 3);
  dropGateway('42');
});

test('getGateway refuses an origin outside ClickUp and reports HTTP errors', async () => {
  const session = { token: 'web', base: 'https://frontdoor-x.clickup.com', workspaceId: '7' };
  await assert.rejects(getGateway(session, { fetchImpl: async () => respond(200, { origin: 'https://evil.io', accessToken: 'x' }) }), /unexpected host/);
  await assert.rejects(getGateway(session, { fetchImpl: async () => respond(401, {}) }), { status: 401 });
});

test('gql posts the operation with the gateway token and surfaces GraphQL errors', async () => {
  const gateway = { origin: 'https://frontdoor-search.clickup-eu.com', accessToken: 'gw' };
  let seen;
  const ok = await gql(gateway, 'aiModels', 'query aiModels { getAIModels }', {}, {
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return respond(200, { data: { getAIModels: [] } });
    },
  });
  assert.deepEqual(ok, { getAIModels: [] });
  assert.equal(seen.url, 'https://frontdoor-search.clickup-eu.com/graphql/gateway?q=aiModels');
  assert.equal(seen.init.headers.Authorization, 'Bearer gw');
  assert.equal(JSON.parse(seen.init.body).operationName, 'aiModels');
  await assert.rejects(gql(gateway, 'x', 'q', {}, { fetchImpl: async () => respond(200, { errors: [{ message: 'UNAUTHENTICATED', extensions: { code: 'UNAUTHENTICATED' } }] }) }), {
    code: 'UNAUTHENTICATED',
  });
});

/** A fake server side of graphql-transport-ws. */
class FakeWS {
  static last = null;
  constructor(url, protocol) {
    this.url = url;
    this.protocol = protocol;
    this.sent = [];
    FakeWS.last = this;
    setTimeout(() => this.onopen?.(), 0);
  }
  send(raw) {
    const msg = JSON.parse(raw);
    this.sent.push(msg);
    if (msg.type === 'connection_init') setTimeout(() => this.push({ type: 'connection_ack' }), 0);
    if (msg.type === 'subscribe') {
      setTimeout(() => {
        this.push({ type: 'ping' });
        this.push({ id: msg.id, type: 'next', payload: { data: { n: 1 } } });
        this.push({ id: msg.id, type: 'next', payload: { data: { n: 2 } } });
        this.push({ id: msg.id, type: 'complete' });
      }, 0);
    }
  }
  push(msg) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  close() {
    this.onclose?.();
  }
}

test('the gateway socket authenticates, answers pings and collects a subscription', async () => {
  const socket = createGatewaySocket({ getGateway: async () => ({ origin: 'https://frontdoor-search.clickup-eu.com', accessToken: 'gw' }), WebSocketImpl: FakeWS });
  const data = await collect(socket, 'subscription S { n }', { a: 1 });
  assert.deepEqual(data, [{ n: 1 }, { n: 2 }]);
  const ws = FakeWS.last;
  assert.equal(ws.url, 'wss://frontdoor-search.clickup-eu.com/graphql/gateway?c=gws-web-1');
  assert.equal(ws.protocol, 'graphql-transport-ws');
  assert.deepEqual(ws.sent[0], { type: 'connection_init', payload: { Authorization: 'Bearer gw' } });
  assert.ok(ws.sent.some((m) => m.type === 'pong'));
  assert.deepEqual(ws.sent.find((m) => m.type === 'subscribe').payload, { query: 'subscription S { n }', variables: { a: 1 } });
  socket.close();
});

test('a closed socket fails its subscriptions and reopens on the next one', async () => {
  let opened = 0;
  const socket = createGatewaySocket({
    getGateway: async () => (opened++, { origin: 'https://frontdoor-search.clickup-eu.com', accessToken: 'gw' }),
    WebSocketImpl: class extends FakeWS {
      send(raw) {
        const msg = JSON.parse(raw);
        if (msg.type === 'subscribe') return this.sent.push(msg); // never answers
        super.send(raw);
      }
    },
  });
  const p = collect(socket, 'subscription S { n }', {}, { timeoutMs: 1000 });
  await new Promise((r) => setTimeout(r, 10));
  FakeWS.last.close();
  await assert.rejects(p, /closed/);
  await collect(socket, 'subscription S { n }', {}, { timeoutMs: 20 });
  assert.equal(opened, 2);
});
