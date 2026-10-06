// Injected (by scripts/render-assets.mjs) into the real side panel / editor when the URL
// has ?demo=<scene>. Fakes the chrome.* APIs and ClickUp API with sample data, then
// drives the UI into the state each store screenshot shows. Sets window.__ready when done.
// All names, emails and tasks here are fictional.
(() => {
  const scene = new URLSearchParams(location.search).get('demo');

  // ---------------------------------------------------------------------------
  // chrome.* stub
  // ---------------------------------------------------------------------------
  const listeners = { local: [], session: [], global: [] };
  const data = {
    local: {
      clickupToken: 'pk_demo',
      prefs: { last: { workspace: '1', 'space:1': '10', 'folder:10': '100', 'list:10/100': '1000' } },
    },
    session: scene === 'existing' ? { recording: { startedAt: Date.now() - 83_000 } } : {},
  };
  const pick = (obj, keys) => {
    if (keys == null) return { ...obj };
    const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
    return Object.fromEntries(list.filter((k) => k in obj).map((k) => [k, obj[k]]));
  };
  const area = (name) => ({
    get: async (keys) => pick(data[name], keys),
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data[name][k], newValue: v };
        data[name][k] = v;
      }
      listeners[name].forEach((fn) => fn(changes));
      listeners.global.forEach((fn) => fn(changes, name));
    },
    async remove(keys) {
      [].concat(keys).forEach((k) => delete data[name][k]);
    },
    onChanged: { addListener: (fn) => listeners[name].push(fn) },
  });
  const noopEvent = { addListener() {} };
  const activeUrl = 'https://shop.acme.dev/checkout';

  window.chrome = {
    storage: { local: area('local'), session: area('session'), onChanged: { addListener: (fn) => listeners.global.push(fn) } },
    tabs: {
      query: async () => [{ id: 7, windowId: 1, index: 0, url: activeUrl }],
      onActivated: noopEvent,
      onUpdated: noopEvent,
      create: async () => {},
      update: async () => {},
      getCurrent: async () => null,
      remove() {},
    },
    runtime: { id: 'demo', sendMessage: async () => ({ ok: false }), getURL: (p) => `/${p}`, openOptionsPage() {} },
    permissions: { contains: async () => true },
  };

  // ---------------------------------------------------------------------------
  // ClickUp API stub
  // ---------------------------------------------------------------------------
  const API = {
    '/team': { teams: [{ id: '1', name: 'Acme Product Team' }] },
    '/team/1/space': { spaces: [{ id: '10', name: 'Web Shop' }] },
    '/space/10/folder': {
      folders: [{ id: '100', name: 'Storefront', lists: [{ id: '1000', name: 'Bugs' }, { id: '1001', name: 'Sprint 24' }] }],
    },
    '/space/10/list': { lists: [{ id: '1002', name: 'Inbox' }] },
    '/list/1000': { statuses: [{ status: 'to do' }, { status: 'in progress' }, { status: 'in review' }, { status: 'done' }] },
    '/list/1000/member': {
      members: [
        { id: 11, username: 'Sara Ahmed' },
        { id: 12, username: 'Omar Khaled' },
        { id: 13, username: 'Lina Park' },
      ],
    },
    '/list/1000/field': {
      fields: [
        { id: 'f-browser', name: 'Browser', type: 'drop_down', type_config: { options: [{ id: 'o1', name: 'Chrome' }, { id: 'o2', name: 'Edge' }, { id: 'o3', name: 'Safari' }] } },
        { id: 'f-sev', name: 'Severity', type: 'emoji', type_config: { count: 5 } },
        { id: 'f-env', name: 'Environment', type: 'labels', type_config: { options: [{ id: 'l1', label: 'Production', color: '#e5484d' }, { id: 'l2', label: 'Staging', color: '#0090ff' }] } },
      ],
    },
    '/space/10/tag': { tags: [{ name: 'checkout', tag_bg: '#f76b15' }, { name: 'frontend', tag_bg: '#7b68ee' }, { name: 'regression', tag_bg: '#e5484d' }] },
    '/task/86c1x2y3z': { id: '86c1x2y3z', name: 'Pay button overlaps the order summary', url: 'https://app.clickup.com/t/86c1x2y3z' },
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname !== 'api.clickup.com') return realFetch(input, init);
    const body = API[url.pathname.replace('/api/v2', '')] ?? {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  // ---------------------------------------------------------------------------
  // Scenes
  // ---------------------------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  async function until(fn, timeout = 8000) {
    const end = Date.now() + timeout;
    while (!fn()) {
      if (Date.now() > end) throw new Error('demo: timed out');
      await sleep(50);
    }
  }
  function setValue(id, value) {
    const node = $(id);
    node.value = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function addAttachments(files) {
    const db = await import('/lib/attachments-db.js');
    for (const f of files) await db.saveAttachment(f);
    await chrome.storage.session.set({ attachmentsChangedAt: Date.now() });
    await until(() => document.querySelectorAll('.attachment').length >= files.length);
  }
  const shotFile = async () =>
    new File([(await DemoShared.mockPng(1600, 1000, { annotated: true })).blob], 'screenshot-2026-10-06-14-32-10.png', { type: 'image/png' });

  async function fillNewTask() {
    await until(() => $('sel-list').value === '1000' && !$('sel-status').disabled);
    setValue('task-title', 'Pay button overlaps the order summary on checkout');
    setValue(
      'task-desc',
      'Steps:\n1. Add any item to the cart\n2. Open checkout in a 1280px-wide window\n\nThe **Pay** button slides over the summary card.',
    );
    setValue('sel-priority', '2');
  }

  const scenes = {
    async new() {
      await fillNewTask();
      const video = new File([await DemoShared.mockVideo()], 'recording-2026-10-06-14-31.webm', { type: 'video/webm' });
      await addAttachments([video, await shotFile()]);
      await sleep(600); // let the video preview decode its first frame
      window.scrollTo(0, $('more-details').offsetTop - 84); // start at the Status row
    },

    async details() {
      await fillNewTask();
      $('more-details').open = true;
      await until(() => $('sel-assignee').options.length > 1 && $('sel-tag').options.length > 1 && $('cf-f-browser'));
      setValue('sel-assignee', '11');
      setValue('sel-assignee', '13');
      setValue('sel-tag', 'checkout');
      setValue('sel-tag', 'frontend');
      setValue('due-date', '2026-10-14');
      setValue('cf-f-browser', 'o1');
      setValue('cf-f-sev', '4');
      setValue('cf-f-env', 'l1');
      window.scrollTo(0, $('more-details').offsetTop - 330);
    },

    async existing() {
      await until(() => $('sel-list').value === '1000');
      $('tab-existing').click();
      setValue('task-ref', 'https://app.clickup.com/t/86c1x2y3z'); // pasted link
      $('task-check').click();
      await until(() => !$('task-found').hidden);
      $('comment-details').open = true;
      setValue('comment-text', 'Recorded the repro on Chrome — see the video and the annotated screenshot.');
      await addAttachments([await shotFile()]);
      window.scrollTo(0, 0);
    },

    async editor() {
      // The editor loads its draft itself; we annotate it the way a user would.
      const canvas = $('canvas');
      await until(() => canvas.width > 300);
      await sleep(200);
      const r = canvas.getBoundingClientRect();
      const k = r.width / DemoShared.BASE_W; // image px → css px (draft is BASE_W wide, uncropped)
      const at = (x, y) => ({ clientX: r.left + x * k, clientY: r.top + y * k, button: 0, pointerId: 1, bubbles: true });
      const ev = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, at(x, y)));
      const tool = (t) => document.querySelector(`[data-tool="${t}"]`).click();

      // Blur the customer's email
      tool('blur');
      ev('pointerdown', 128, 330);
      ev('pointermove', 520, 374);
      ev('pointerup', 520, 374);

      // Circle the overlapping button (red, large)
      document.querySelector('[data-size="l"]').click();
      tool('pen');
      const cx = 940;
      const cy = 676;
      ev('pointerdown', cx + 250, cy);
      for (let a = 0; a <= Math.PI * 2.08; a += 0.12) ev('pointermove', cx + 250 * Math.cos(a), cy + 80 * Math.sin(a));
      ev('pointerup', cx + 250, cy);

      // Label it
      tool('text');
      ev('pointerdown', 700, 790);
      await sleep(120);
      const input = $('text-input');
      input.value = 'Overlaps the order summary';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      tool('pen');
    },
  };

  window.addEventListener('load', async () => {
    try {
      Element.prototype.setPointerCapture = function () {};
      await sleep(300);
      await scenes[scene]?.();
    } catch (err) {
      console.error(err);
    }
    await sleep(400);
    window.__ready = true;
  });
})();
