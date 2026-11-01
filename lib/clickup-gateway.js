// ClickUp's GraphQL gateway, used by the Brain tab for the model list, search and live answers.
// Part of ClickUp's private web-app API (see lib/clickup-webapp.js); captured 2026-10-29.
//
//  1. getGateway(): GET <frontdoor>/v2/sd/team/<ws>/access-token with the web-app session token →
//     { origin, accessToken, expiresIn }. `origin` is the gateway of the workspace's region (EU workspaces:
//     https://frontdoor-search.clickup-eu.com); the token lasts a few minutes and is the only one the
//     gateway accepts (the session token itself is refused).
//  2. gql(): POST <origin>/graphql/gateway?q=<operation> with `Authorization: Bearer <accessToken>`.
//  3. createGatewaySocket(): wss://<origin host>/graphql/gateway, protocol graphql-transport-ws, for the
//     subscription-only operations (search, a running answer).
// The CSP allows https/wss to *.clickup.com and *.clickup-eu.com only; gatewayOrigin() rejects anything else.

/** The gateway origin if it is one of ClickUp's own hosts, else null. */
export function gatewayOrigin(origin) {
  const m = /^https:\/\/([a-z0-9-]+\.)+clickup(-eu)?\.com$/i.exec(String(origin || ''));
  return m ? m[0].toLowerCase() : null;
}

/** The websocket URL of a gateway origin. */
export function gatewaySocketUrl(origin) {
  return `${origin.replace(/^https:/i, 'wss:')}/graphql/gateway?c=gws-web-1`;
}

export class GatewayError extends Error {
  constructor(message, { status = 0, code } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.code = code;
  }
}

/** Refresh the gateway token this long before ClickUp says it expires. */
const MARGIN_MS = 30_000;
const cache = new Map(); // workspaceId → { gateway, expiresAt }

/**
 * The gateway origin and a fresh access token for the session's workspace (cached until shortly before expiry).
 * @param {{ token: string, base: string, workspaceId: string }} session
 * @returns {Promise<{ origin: string, accessToken: string }>}
 */
export async function getGateway(session, { fetchImpl = fetch, now = Date.now } = {}) {
  const hit = cache.get(session.workspaceId);
  if (hit && hit.token === session.token && hit.expiresAt > now()) return hit.gateway;
  let res;
  try {
    res = await fetchImpl(`${session.base}/v2/sd/team/${encodeURIComponent(session.workspaceId)}/access-token`, {
      headers: { Authorization: `Bearer ${session.token}`, Accept: 'application/json' },
      credentials: 'omit',
    });
  } catch {
    throw new GatewayError('Network error while reaching ClickUp.');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new GatewayError(`ClickUp refused the search token (HTTP ${res.status}).`, { status: res.status, code: json?.ECODE });
  const origin = gatewayOrigin(json?.origin);
  if (!origin || !json?.accessToken) throw new GatewayError("ClickUp's search service is on an unexpected host.");
  const gateway = { origin, accessToken: String(json.accessToken) };
  const ttl = Math.max(Number(json.expiresIn) || 0, 60) * 1000;
  cache.set(session.workspaceId, { gateway, token: session.token, expiresAt: now() + ttl - MARGIN_MS });
  return gateway;
}

/** Forgets a workspace's gateway token (after an UNAUTHENTICATED answer). */
export function dropGateway(workspaceId) {
  cache.delete(workspaceId);
}

/** Runs a GraphQL operation over HTTP; returns `data` or throws a GatewayError. */
export async function gql(gateway, operationName, query, variables = {}, { fetchImpl = fetch, signal } = {}) {
  let res;
  try {
    res = await fetchImpl(`${gateway.origin}/graphql/gateway?q=${encodeURIComponent(operationName)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gateway.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ operationName, variables, query }),
      credentials: 'omit',
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new GatewayError('Network error while reaching ClickUp.');
  }
  const json = await res.json().catch(() => null);
  const error = json?.errors?.[0];
  if (!res.ok || error || !json?.data) {
    const code = error?.extensions?.code;
    console.warn('[gateway] request rejected', { operationName, status: res.status, code });
    throw new GatewayError(error?.message || `ClickUp's search service failed (HTTP ${res.status}).`, { status: res.status, code });
  }
  return json.data;
}

/**
 * A lazily opened graphql-transport-ws connection to the gateway. `subscribe()` opens it when needed and
 * reopens it (with a fresh token) after it closed; `close()` ends it.
 * @param {{ getGateway: () => Promise<{ origin: string, accessToken: string }>, WebSocketImpl?: typeof WebSocket, timeoutMs?: number }} opts
 */
export function createGatewaySocket({ getGateway: loadGateway, WebSocketImpl = globalThis.WebSocket, timeoutMs = 10_000 }) {
  let ws = null;
  let ready = null;
  let nextId = 1;
  const subs = new Map(); // id → { next, error, complete }

  function fail(err) {
    for (const s of subs.values()) s.error?.(err);
    subs.clear();
  }

  function open() {
    if (ready) return ready;
    ready = (async () => {
      const gateway = await loadGateway();
      const sock = new WebSocketImpl(gatewaySocketUrl(gateway.origin), 'graphql-transport-ws');
      ws = sock;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new GatewayError('ClickUp did not answer the live connection.')), timeoutMs);
        sock.onopen = () => sock.send(JSON.stringify({ type: 'connection_init', payload: { Authorization: `Bearer ${gateway.accessToken}` } }));
        sock.onmessage = (event) => {
          let msg;
          try {
            msg = JSON.parse(event.data);
          } catch {
            return;
          }
          if (msg.type === 'connection_ack') {
            clearTimeout(timer);
            resolve();
          } else if (msg.type === 'ping') sock.send(JSON.stringify({ type: 'pong' }));
          else if (msg.type === 'next') subs.get(msg.id)?.next?.(msg.payload);
          else if (msg.type === 'error') {
            subs.get(msg.id)?.error?.(new GatewayError(msg.payload?.[0]?.message || 'Live update failed.'));
            subs.delete(msg.id);
          } else if (msg.type === 'complete') {
            subs.get(msg.id)?.complete?.();
            subs.delete(msg.id);
          }
        };
        sock.onerror = () => {
          clearTimeout(timer);
          reject(new GatewayError('Could not open the live connection to ClickUp.'));
        };
        sock.onclose = () => {
          clearTimeout(timer);
          reject(new GatewayError('The live connection to ClickUp closed.'));
          if (ws === sock) {
            ws = null;
            ready = null;
          }
          fail(new GatewayError('The live connection to ClickUp closed.'));
        };
      });
    })();
    ready.catch(() => {
      ready = null;
    });
    return ready;
  }

  return {
    /**
     * Starts a subscription; resolves to a function that stops it.
     * @param {string} query
     * @param {object} variables
     * @param {{ next?: (payload: { data?: any, errors?: any[] }) => void, error?: (err: Error) => void, complete?: () => void }} handlers
     */
    async subscribe(query, variables, handlers) {
      await open();
      const id = String(nextId++);
      subs.set(id, handlers);
      ws.send(JSON.stringify({ id, type: 'subscribe', payload: { query, variables } }));
      return () => {
        if (!subs.delete(id)) return;
        try {
          ws?.send(JSON.stringify({ id, type: 'complete' }));
        } catch {
          /* already closed */
        }
      };
    },
    close() {
      const sock = ws;
      ws = null;
      ready = null;
      subs.clear();
      try {
        sock?.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Collects a subscription's `next` payloads until it completes (or `timeoutMs`), e.g. a search.
 * @returns {Promise<any[]>} the `data` of each `next`
 */
export function collect(socket, query, variables, { timeoutMs = 8000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const out = [];
    let stop = null;
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop?.();
      if (err) reject(err);
      else resolve(out);
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    signal?.addEventListener('abort', () => finish(new DOMException('Aborted', 'AbortError')), { once: true });
    socket
      .subscribe(query, variables, {
        next: (payload) => {
          if (payload?.data) out.push(payload.data);
        },
        error: finish,
        complete: () => finish(),
      })
      .then((s) => {
        if (done) s();
        else stop = s;
      }, finish);
  });
}
