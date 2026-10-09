// Minimal in-memory chrome.storage for unit tests (lib/storage.js and lib/clickup-api.js
// only touch chrome.storage). Call installChrome() in a beforeEach to start clean.
// `extras` are merged into the stub, e.g. { sidebarAction: {} } to look like Firefox.

export function installChrome(initialLocal = {}, extras = {}) {
  const listeners = [];
  const local = { ...initialLocal };

  const pick = (keys) => {
    if (keys == null) return { ...local };
    const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
    return Object.fromEntries(list.filter((k) => k in local).map((k) => [k, local[k]]));
  };

  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => pick(keys),
        async set(items) {
          const changes = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: local[k], newValue: v };
            local[k] = v;
          }
          listeners.forEach((fn) => fn(changes, 'local'));
        },
        async remove(keys) {
          const changes = {};
          for (const k of [].concat(keys)) {
            changes[k] = { oldValue: local[k], newValue: undefined };
            delete local[k];
          }
          listeners.forEach((fn) => fn(changes, 'local'));
        },
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
    ...extras,
  };
  return { local };
}

/**
 * Replaces globalThis.fetch with a scripted mock. `responses` are returned in order
 * ({ status, body, headers }); every call is recorded in `calls`.
 */
export function mockFetch(responses) {
  const calls = [];
  const queue = [...responses];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    const next = queue.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(next.body ?? {}), {
      status: next.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...(next.headers || {}) },
    });
  };
  return calls;
}
