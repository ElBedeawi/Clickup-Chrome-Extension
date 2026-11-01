// Injected (by scripts/lib/headless.mjs) into the real side panel / editor when the URL
// has ?demo=<scene>. Fakes the chrome.* APIs and ClickUp API with sample data, then
// drives the UI into the state each store screenshot shows. Sets window.__ready when done.
// Add &browser=firefox to get the Firefox (sidebar) variant of the UI (see lib/platform.js).
// All names, emails and tasks here are fictional.
(() => {
  const params = new URLSearchParams(location.search);
  const scene = params.get('demo');
  const browser = params.get('browser') || 'chrome';
  // The `existing` scene is mid-recording; &rec=paused (mic muted) or &rec=countdown shows the
  // other states of the recording strip.
  const rec = params.get('rec');
  const now = Date.now();
  const recording = {
    id: 1,
    startedAt: now - 83_000,
    camera: true,
    mic: true,
    pausedAt: null,
    pausedMs: 0,
    micMuted: false,
    ...(rec === 'paused' ? { pausedAt: now - 9_000, micMuted: true } : {}),
    ...(rec === 'countdown' ? { startedAt: now + 60_000 } : {}), // far enough ahead to stay put during a test
  };

  // ---------------------------------------------------------------------------
  // chrome.* stub
  // ---------------------------------------------------------------------------
  const listeners = { local: [], session: [], global: [] };
  const data = {
    local: {
      clickupToken: 'pk_demo',
      prefs: {
        last: { workspace: '1', 'space:1': '10', 'folder:10': '100', 'list:10/100': '1000' },
        // A camera picked, so the Record clip card shows the bubble control.
        recorder: { camera: 'cam-webcam', bubble: { x: 0, y: 1, size: 'md' }, blur: 'medium' },
      },
    },
    session: scene === 'existing' ? { recording } : {},
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
    runtime: {
      id: 'demo',
      sendMessage: async () => ({ ok: false }),
      onMessage: noopEvent,
      getURL: (p) => `/${p}`,
      openOptionsPage() {},
    },
    permissions: { contains: async () => true },
    // The web-app token mint (sidepanel/webapp-session.js) runs mintTokenInPage in a ClickUp tab.
    scripting: {
      executeScript: async ({ args = [] }) => [{ result: { ok: true, token: 'demo-session', workspaceId: String(args[0] || '1'), expiresAt: now + 3_600_000 } }],
    },
    // What lib/platform.js sniffs: Chrome has a side panel + offscreen documents, Firefox a sidebar.
    ...(browser === 'firefox' ? { sidebarAction: { toggle() {}, open() {} } } : { sidePanel: {}, offscreen: {} }),
  };

  // Microphones and cameras shown in the Record clip card (no real devices in headless Chrome).
  const fakeDevices = [
    { kind: 'audioinput', deviceId: 'default', label: 'Default - Microphone (HD Webcam)' },
    { kind: 'audioinput', deviceId: 'mic-webcam', label: 'Microphone (HD Webcam)' },
    { kind: 'audioinput', deviceId: 'mic-headset', label: 'Headset Microphone (USB Audio)' },
    { kind: 'videoinput', deviceId: 'cam-webcam', label: 'HD Webcam' },
    { kind: 'videoinput', deviceId: 'cam-usb', label: 'USB Camera (046d:0825)' },
  ];
  if (navigator.mediaDevices) navigator.mediaDevices.enumerateDevices = async () => fakeDevices;
  // &cam=1: camera and mic access granted, with a fake camera (a drawn figure in a room), so the
  // bubble preview and the Camera check dialog have something to show.
  const fakeCamera = params.get('cam') === '1';
  navigator.permissions.query = async () => ({ state: fakeCamera ? 'granted' : 'prompt', onchange: null });
  if (fakeCamera && navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints.audio && !constraints.video) return new AudioContext().createMediaStreamDestination().stream;
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 480;
      const x = c.getContext('2d');
      const paint = (t = performance.now()) => {
        // A room: wall, shelf with books, a plant, a window.
        x.fillStyle = '#d9cbb5';
        x.fillRect(0, 0, 640, 480);
        x.fillStyle = '#a8c8e8';
        x.fillRect(430, 40, 170, 150);
        x.fillStyle = '#7a5a3c';
        x.fillRect(20, 150, 230, 12);
        ['#c0392b', '#2e86de', '#27ae60', '#f39c12', '#8e44ad', '#16a085'].forEach((col, i) => {
          x.fillStyle = col;
          x.fillRect(30 + i * 34, 80 + (i % 2) * 12, 26, 70 - (i % 2) * 12);
        });
        x.fillStyle = '#2d6a4f';
        x.beginPath();
        x.ellipse(560, 330, 50, 80, 0, 0, Math.PI * 2);
        x.fill();
        // The person: shoulders and head, swaying a little.
        const sway = Math.sin(t / 700) * 8;
        x.fillStyle = '#3b4a6b';
        x.beginPath();
        x.ellipse(320 + sway, 480, 170, 120, 0, Math.PI, 0);
        x.fill();
        x.fillStyle = '#c99a78';
        x.fillRect(296 + sway, 300, 48, 60);
        x.beginPath();
        x.ellipse(320 + sway, 250, 72, 90, 0, 0, Math.PI * 2);
        x.fill();
        x.fillStyle = '#2b2018';
        x.beginPath();
        x.ellipse(320 + sway, 190, 76, 42, 0, Math.PI, 0);
        x.fill();
      };
      paint();
      setInterval(paint, 66);
      return c.captureStream(15);
    };
  }

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
        { id: 'f-email', name: 'Customer email', type: 'email' },
        { id: 'f-amount', name: 'Order total', type: 'currency' },
        { id: 'f-found', name: 'Found on', type: 'date' },
        { id: 'f-env', name: 'Environment', type: 'labels', type_config: { options: [{ id: 'l1', label: 'Production', color: '#e5484d' }, { id: 'l2', label: 'Staging', color: '#0090ff' }] } },
      ],
    },
    '/space/10/tag': { tags: [{ name: 'checkout', tag_bg: '#f76b15' }, { name: 'frontend', tag_bg: '#7b68ee' }, { name: 'regression', tag_bg: '#e5484d' }] },
    '/task/86c1x2y3z': {
      id: '86c1x2y3z',
      name: 'Pay button overlaps the order summary',
      url: 'https://app.clickup.com/t/86c1x2y3z',
      team_id: '1',
      status: { status: 'in review', color: '#f8ae00' },
    },
    '/shard/v1/handshake/1': { appEnvironment: { apiUrlBase: 'https://frontdoor-demo.clickup.com' } },
    // Brain² skills are tasks in a hidden list (see brainApi's feature_entities answer).
    '/list/9900/task': {
      tasks: [
        { id: 'sk1', name: 'Bug triage', text_content: 'Classify a bug by severity and suggest an owner.' },
        { id: 'sk2', name: 'Release notes', text_content: 'Turn finished tasks into short release notes.' },
      ],
    },
  };

  // ClickUp Brain² over the web-app API (lib/clickup-brain.js, lib/clickup-gateway.js): the ASK_AI room,
  // questions posted as comments, Brain's answer in the thread (after one empty poll, with a progress
  // step), and the GraphQL gateway (models over HTTP; search and the live answer over a websocket).
  const BRAIN_REPLY = [
    { type: 'task_mention', task_mention: { task_id: '86c1x2y3z', team_id: '1' }, text: '86c1x2y3z' },
    { text: ' is ', attributes: {} },
    { text: 'in review', attributes: { bold: true } },
    { text: '. Before it can close:', attributes: {} },
    { text: '\n', attributes: {} },
    { text: 'Check the fix on Safari: only Chrome and Edge were tested', attributes: {} },
    { text: '\n', attributes: { list: 'bullet' } },
    { text: 'Sara Ahmed still has to review the ', attributes: {} },
    { text: 'checkout.css', attributes: { code: true } },
    { text: ' change', attributes: {} },
    { text: '\n', attributes: { list: 'bullet' } },
    { text: 'Omar Khaled saw the same overlap on the cart page; it may need its own task.', attributes: {} },
    { text: '\n', attributes: {} },
  ];
  const BRAIN_LIVE = 'Pay button overlaps the order summary is **in review**. Before it can close:\n- Check the fix on Safari';
  const MODELS = [
    { id: 'brain', type: 'brain', name: 'Brain²', description: 'Uses latest Anthropic models', reasoningLevels: [], canUse: true, features: [] },
    {
      id: 'agent-v1-unified-gpt-6-astra',
      canonicalId: 'gpt-6-astra',
      type: 'agent',
      name: 'GPT-6 Astra',
      description: "OpenAI's most capable model for complex end-to-end work",
      badge: 'New',
      canUse: true,
      reasoningLevels: [{ key: 'low', label: 'Low' }, { key: 'medium', label: 'Medium' }, { key: 'high', label: 'High' }],
    },
    {
      id: 'agent-v2-claude-opus-5-5',
      canonicalId: 'claude-opus-5-5',
      type: 'agent',
      name: 'Claude Opus 5.5',
      description: "Anthropic's most capable model",
      canUse: true,
      reasoningLevels: [{ key: 'low', label: 'Low' }, { key: 'medium', label: 'Medium' }, { key: 'high', label: 'High' }],
    },
    { id: 'gpt-image-2', type: 'image', name: 'GPT Image 2', canUse: true },
  ];
  const SEARCH = [
    { externalID: 'task:86c1x2y3z', title: 'Pay button overlaps the order summary', type: 'clickup_task', data: '{"status_raw":"in review","status_color":"#f8ae00"}' },
    { externalID: 'task:86c1x2y40', title: 'Cart summary card cut off on mobile', type: 'clickup_task', data: '{"status_raw":"to do","status_color":"#87909e"}' },
    { externalID: 'doc:demo-doc-1', title: 'Checkout redesign spec', type: 'clickup_document_page', data: '{}' },
  ];
  // What the panel sent, for the smoke test (window.__brain).
  const brain = (window.__brain = { questions: [], bodies: [], polls: 0, uploads: 0 });
  function brainApi(url, init) {
    const path = url.pathname;
    if (path === '/chat/v1/workspaces/1/chat/rooms/delta/0') {
      return { rooms: [{ status: 'found', data: { id: 'demo-ask-ai', type: 'ASK_AI', members: ['-4', '11'] } }] };
    }
    if (path === '/v2/sd/team/1/access-token') {
      return { origin: 'https://frontdoor-search.clickup-eu.com', accessToken: 'demo-gateway', expiresIn: 480 };
    }
    if (path === '/data/v3/workspaces/1/feature_entities/ai_skills') return { list_id: '9900' };
    if (/\/comments\/(view|comment)\//.test(path)) {
      const id = String(9000 + brain.questions.length);
      brain.questions.push(id);
      brain.bodies.push(JSON.parse(init?.body || '{}'));
      brain.polls = 0;
      return { id: Number(id) };
    }
    const invoke = brain.questions.at(-1);
    if (path.endsWith('/comments/bulk')) {
      return { comments: [{ data: { id: invoke, extra: { interaction_log: { '-4': [{ displayText: 'Reading the task' }] } } } }] };
    }
    if (path.endsWith('/comments/delta/0')) {
      if (brain.polls++ < 1) return { comments: [] };
      const replies = brain.questions.map((q, i) => ({
        data: {
          id: `r${q}`,
          userid: -4,
          comment_type: 'ai',
          text_content: i ? 'Yes: the cart page uses the same summary card component.' : 'Answer',
          comment: i ? [{ text: 'Yes: the cart page uses the same summary card component.', attributes: {} }, { text: '\n', attributes: {} }] : BRAIN_REPLY,
          extra: { triggered_on: { externalID: `comment:${q}` }, conversation_id: '7000000000000000001' },
        },
      }));
      return { comments: replies };
    }
    return {};
  }

  // File uploads go through XHR (for progress): answer the Brain² upload host here too.
  const RealXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = class extends RealXHR {
    open(method, url, ...rest) {
      this.__demo = /^https:\/\/frontdoor-demo\.clickup\.com\/v1\/attachment/.test(url);
      if (!this.__demo) super.open(method, url, ...rest);
    }
    setRequestHeader(...args) {
      if (!this.__demo) super.setRequestHeader(...args);
    }
    send(body) {
      if (!this.__demo) return super.send(body);
      const file = body.get('attachment');
      brain.uploads++;
      setTimeout(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 });
        Object.defineProperty(this, 'status', { value: 200 });
        Object.defineProperty(this, 'response', {
          value: { id: `att${brain.uploads}.txt`, name: file.name, title: file.name, extension: 'txt', url: `https://t1.clickup-attachments.com/${file.name}` },
        });
        this.onload?.();
      }, 100);
    }
  };

  // The gateway's websocket (graphql-transport-ws): search results and Brain's answer as it's written.
  const RealWebSocket = window.WebSocket;
  window.WebSocket = class {
    constructor(url, protocol) {
      if (!String(url).startsWith('wss://frontdoor-search.clickup-eu.com/')) return new RealWebSocket(url, protocol);
      this.readyState = 0;
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.();
      }, 20);
    }
    reply(msg) {
      setTimeout(() => this.onmessage?.({ data: JSON.stringify(msg) }), 30);
    }
    send(raw) {
      const msg = JSON.parse(raw);
      if (msg.type === 'connection_init') return this.reply({ type: 'connection_ack' });
      if (msg.type !== 'subscribe') return;
      const { query, variables } = msg.payload;
      if (query.includes('search(')) {
        const q = new URLSearchParams(variables.q.slice(2));
        const kind = q.get('assetType') === 'document' ? 'doc:' : 'task:';
        const words = (q.get('keywords') || '').toLowerCase();
        const items = SEARCH.filter((s) => s.externalID.startsWith(kind) && s.title.toLowerCase().includes(words));
        this.reply({ id: msg.id, type: 'next', payload: { data: { result: { items: items.map((ent) => ({ ent })) } } } });
        setTimeout(() => this.reply({ id: msg.id, type: 'complete' }), 40);
      } else if (query.includes('activeAgentRuns')) {
        const wait = setInterval(() => {
          const q = brain.questions.at(-1);
          if (!q) return;
          clearInterval(wait);
          this.reply({ id: msg.id, type: 'next', payload: { data: { activeAgentRuns: [{ conversationId: '7000000000000000001', status: 'GENERATING', invokeId: `comment:${q}` }] } } });
        }, 50);
      } else if (query.includes('aiConversationStatus')) {
        [40, 70, 100].forEach((pct, i) =>
          setTimeout(() => {
            const answer = BRAIN_LIVE.slice(0, Math.round((BRAIN_LIVE.length * pct) / 100));
            this.reply({ id: msg.id, type: 'next', payload: { data: { aiConversationStatus: { status: 'GENERATING', result: { answer, answerComplete: false } } } } });
          }, 150 * (i + 1)),
        );
      }
    }
    close() {}
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.hostname === 'frontdoor-demo.clickup.com') return json(brainApi(url, init));
    if (url.hostname === 'frontdoor-search.clickup-eu.com') return json({ data: { getAIModels: MODELS } });
    if (url.hostname !== 'api.clickup.com') return realFetch(input, init);
    return json(API[url.pathname.replace('/api/v2', '')] ?? {});
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
    const node = typeof id === 'string' ? $(id) : id;
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
    const desc = document.querySelector('#task-desc .rte-body');
    desc.innerHTML =
      '<p>Steps:</p><ol><li>Add any item to the cart</li><li>Open checkout in a 1280px-wide window</li></ol>' +
      '<p>The <b>Pay</b> button slides over the summary card.</p>';
    desc.dispatchEvent(new Event('input', { bubbles: true }));
    setValue('sel-priority', '2');
  }

  const scenes = {
    async new() {
      await fillNewTask();
      const video = new File([await DemoShared.mockVideo()], 'recording-2026-10-06-14-31.webm', { type: 'video/webm' });
      await addAttachments([video, await shotFile()]);
      $('tool-record').click(); // open the Record clip card
      await sleep(600); // let the card refresh and the video preview decode its first frame
      $('rc-meter-fill').style.width = '38%'; // as if someone is talking
      window.scrollTo(0, $('more-details').offsetTop - 30);
    },

    async menu() {
      await until(() => $('sel-list').value === '1000');
      $('tool-record').click();
      await sleep(400);
      const which = new URLSearchParams(location.search).get('menu');
      const target = which === 'shot' ? $('tool-shot') : $(`rc-${which}`);
      target.querySelector('button').click();
      window.scrollTo(0, $('attachments').offsetTop - 20);
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

    async clips() {
      await until(() => $('sel-list').value === '1000');
      $('tab-clips').click(); // the Record clip card opens by itself in the Clips tab
      const video = new File([await DemoShared.mockVideo()], 'recording-2026-10-06-14-31.webm', { type: 'video/webm' });
      await addAttachments([video]);
      await sleep(600); // let the video preview decode its first frame
      window.scrollTo(0, 0);
    },

    // &ask=0: just the empty Brain tab with the task offered (no question asked).
    async brain() {
      await until(() => $('sel-list').value === '1000');
      setValue('task-ref', 'https://app.clickup.com/t/86c1x2y3z'); // as if detected from the current tab
      $('tab-brain').click(); // looks the task up and offers it as a chip
      await until(() => document.querySelector('.brain-chip.suggest'));
      // &pop=plus|skills|model: open that menu of the composer (plus searches for "pay").
      const pop = params.get('pop');
      if (pop) {
        $(`brain-${pop}`).click();
        if (pop === 'plus') setValue(document.querySelector('#brain-pop input'), 'pay');
        await until(() => (pop === 'plus' ? document.querySelector('#brain-pop .brain-results .brain-row') : document.querySelectorAll('#brain-pop .brain-row').length > 1));
        return;
      }
      if (params.get('ask') === '0') return;
      document.querySelector('.brain-chip.suggest').click(); // ask about the detected task
      setValue('brain-input', "What's left before we can close this bug?");
      $('brain-send').click();
      await until(() => document.querySelector('.brain-msg.brain .brain-body .mention[title]'));
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
      // &open=camera-check: open the Camera check dialog from the Record clip card.
      if (params.get('open') === 'camera-check') {
        if ($('record-card').hidden) $('tool-record').click();
        await sleep(300);
        $('rc-preview-open').click();
        // With a fake camera and blur on, wait for the segmenter (the loading pill goes away).
        const stage = document.querySelector('.cc-stage');
        const shown = () => !fakeCamera || (stage.classList.contains('has-view') && $('cc-loading').hidden);
        await until(() => $('camera-check').open && shown(), 15_000).catch(() => {});
        await sleep(300);
      }
    } catch (err) {
      console.error(err);
    }
    await sleep(400);
    window.__ready = true;
  });
})();
