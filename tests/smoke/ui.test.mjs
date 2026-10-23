// Smoke tests: load the real side panel, editor and settings page in a headless browser with
// fake chrome.* / ClickUp APIs (store/src/demo-stub.js) and fail on any page error.
// Needs Chrome or Edge (set CHROME=/path if it isn't found). Run: npm run test:smoke
// firefox.test.mjs runs the same scenes in headless Firefox (npm run test:smoke:firefox).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withBrowser } from '../../scripts/lib/headless.mjs';

/** Opens a page, asserts it got ready without errors, runs `check(page)`, closes it. */
async function scene(openPage, url, check, { width = 400, height = 800 } = {}) {
  const page = await openPage({ url, width, height });
  try {
    assert.deepEqual(page.errors, [], `page errors on ${url}`);
    assert.ok(page.ready, `${url} never signalled ready (the demo scene probably failed)`);
    await check?.(page);
  } finally {
    await page.close();
  }
}

await withBrowser(async ({ openPage }) => {
  await test('side panel: new task with a recording and a screenshot', () =>
    scene(openPage, '/sidepanel/sidepanel.html?demo=new', async (page) => {
      const state = JSON.parse(
        await page.evaluate(`JSON.stringify({
          list: document.getElementById('sel-list').value,
          location: document.getElementById('location').open,
          path: document.getElementById('location-path').textContent,
          attachments: document.querySelectorAll('.attachment').length,
          tabs: document.querySelectorAll('.tab').length, // New task / Existing task / Clips
          clipsPanel: !document.getElementById('panel-clips').hidden,
          shotTool: !document.getElementById('tool-shot').hidden,
          cardOpen: !document.getElementById('record-card').hidden,
          bubble: !document.getElementById('rc-bubble-row').hidden,
          submit: document.getElementById('btn-submit').textContent,
        })`),
      );
      assert.deepEqual(state, {
        list: '1000',
        location: false,
        path: 'Web Shop › Storefront › Bugs',
        attachments: 2,
        tabs: 3,
        clipsPanel: false,
        shotTool: true,
        cardOpen: true,
        bubble: true,
        submit: 'Create task & upload',
      });
    }));

  await test('side panel: the Clips tab is video-only, remembers itself and saves to the Clips Hub', () =>
    scene(openPage, '/sidepanel/sidepanel.html?demo=clips', async (page) => {
      const state = JSON.parse(
        await page.evaluate(`(async () => {
          const $ = (id) => document.getElementById(id);
          const before = {
            selected: $('tab-clips').getAttribute('aria-selected'),
            clipsPanel: !$('panel-clips').hidden,
            newPanel: !$('panel-new').hidden,
            shotTool: !$('tool-shot').hidden,
            accept: $('file-input').accept,
            cardOpen: !$('record-card').hidden,
            title: $('att-title').textContent,
            attachments: document.querySelectorAll('.attachment').length,
            skipped: document.querySelectorAll('.attachment.skipped').length,
            submit: $('btn-submit').textContent,
            autoSave: $('clips-auto-save').checked,
            mode: (await chrome.storage.local.get('prefs')).prefs.mode,
          };
          // A screenshot dropped on the panel is refused here: Clips are videos.
          const dt = new DataTransfer();
          dt.items.add(new File(['x'], 'shot.png', { type: 'image/png' }));
          document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
          await new Promise((r) => setTimeout(r, 50));
          const dropped = { error: $('error').textContent, attachments: document.querySelectorAll('.attachment').length };
          // The toggle is remembered next to the shard cache.
          $('clips-auto-save').click();
          await new Promise((r) => setTimeout(r, 50));
          const prefs = (await chrome.storage.local.get('prefs')).prefs;
          // Back in a task tab the same file is listed with the usual label.
          $('tab-new').click();
          await new Promise((r) => setTimeout(r, 50)); // the tab is persisted asynchronously
          const back = { submit: $('btn-submit').textContent, title: $('att-title').textContent, shotTool: !$('tool-shot').hidden, mode: (await chrome.storage.local.get('prefs')).prefs.mode };
          return JSON.stringify({ before, dropped, autoSave: prefs.clips.autoSave, last: prefs.last.workspace, back });
        })()`),
      );
      assert.deepEqual(state.before, {
        selected: 'true',
        clipsPanel: true,
        newPanel: false,
        shotTool: false,
        accept: 'video/*',
        cardOpen: true,
        title: 'Clips',
        attachments: 1,
        skipped: 0,
        submit: 'Save to Clips',
        autoSave: false,
        mode: 'clips',
      });
      assert.match(state.dropped.error, /shot\.png: Only videos can be saved to Clips\./);
      assert.equal(state.dropped.attachments, 1);
      assert.equal(state.autoSave, true);
      assert.equal(state.last, '1', 'the other prefs survive the clips merge');
      assert.deepEqual(state.back, { submit: 'Create task & upload', title: 'Attachments', shotTool: true, mode: 'new' });
    }));

  await test('side panel: the location row opens when no list is picked and collapses once one is', () =>
    scene(openPage, '/sidepanel/sidepanel.html?demo=new', async (page) => {
      const state = JSON.parse(
        await page.evaluate(`(async () => {
          const loc = document.getElementById('location');
          const list = document.getElementById('sel-list');
          const path = () => document.getElementById('location-path').textContent;
          const change = (value) => {
            list.value = value;
            list.dispatchEvent(new Event('change'));
            return new Promise((r) => setTimeout(r, 100));
          };
          await change('');
          const cleared = { open: loc.open, path: path(), button: document.getElementById('location-change').textContent };
          document.getElementById('btn-submit').click();
          await new Promise((r) => setTimeout(r, 50));
          const submitted = { error: document.getElementById('error').textContent, focused: document.activeElement.id };
          await change('1001');
          const picked = { open: loc.open, path: path(), button: document.getElementById('location-change').textContent };
          return JSON.stringify({ cleared, submitted, picked });
        })()`),
      );
      assert.deepEqual(state, {
        cleared: { open: true, path: 'Web Shop › Storefront › Choose a list', button: 'Done' },
        submitted: { error: 'Pick a list for the new task.', focused: 'sel-list' },
        picked: { open: false, path: 'Web Shop › Storefront › Sprint 24', button: 'Change' },
      });
    }));

  await test('side panel: the description editor has a formatting toolbar and gives Markdown', () =>
    scene(openPage, '/sidepanel/sidepanel.html?demo=new', async (page) => {
      const state = JSON.parse(
        await page.evaluate(`(async () => {
          const body = document.querySelector('#task-desc .rte-body');
          const { toMarkdown } = await import('/lib/markdown.js');
          return JSON.stringify({
            buttons: document.querySelectorAll('#task-desc .rte-btn').length,
            editable: body.isContentEditable,
            markdown: toMarkdown(body),
          });
        })()`),
      );
      assert.ok(state.buttons >= 14, `expected the formatting buttons, got ${state.buttons}`);
      assert.equal(state.editable, true);
      assert.equal(
        state.markdown,
        'Steps:\n\n1. Add any item to the cart\n2. Open checkout in a 1280px-wide window\n\nThe **Pay** button slides over the summary card.',
      );
    }));

  await test('side panel: More details loads assignees, tags and custom fields', () =>
    scene(openPage, '/sidepanel/sidepanel.html?demo=details', async (page) => {
      assert.equal(await page.evaluate(`document.getElementById('more-count').textContent`), '6 set');
      assert.equal(await page.evaluate(`document.querySelectorAll('#assignee-chips .chip').length`), 2);
      assert.ok((await page.evaluate(`document.querySelectorAll('#custom-fields .field').length`)) >= 3);
    }));

  await test('side panel: existing task, mid-recording, with a comment', () =>
    scene(openPage, '/sidepanel/sidepanel.html?demo=existing', async (page) => {
      assert.match(await page.evaluate(`document.getElementById('task-found').textContent`), /Pay button overlaps/);
      assert.equal(await page.evaluate(`document.getElementById('recording').hidden`), false);
      assert.equal(await page.evaluate(`document.getElementById('tool-record').disabled`), true);
      // The running clip has a camera bubble, so the strip offers to move it.
      assert.equal(await page.evaluate(`document.getElementById('rec-bubble').hidden`), false);
      const strip = JSON.parse(
        await page.evaluate(`JSON.stringify({
          label: document.getElementById('rec-label').textContent,
          time: document.getElementById('rec-time').textContent,
          pause: document.getElementById('btn-pause').getAttribute('aria-label'),
          pauseDisabled: document.getElementById('btn-pause').disabled,
          muteHidden: document.getElementById('btn-mute').hidden,
          mute: document.getElementById('btn-mute').getAttribute('aria-pressed'),
        })`),
      );
      assert.deepEqual(
        { ...strip, time: undefined },
        { label: 'Recording', time: undefined, pause: 'Pause recording', pauseDisabled: false, muteHidden: false, mute: 'false' },
      );
      assert.match(strip.time, /^01:2\d$/);
    }));

  await test('side panel: a paused recording with the mic muted', () =>
    scene(openPage, '/sidepanel/sidepanel.html?demo=existing&rec=paused', async (page) => {
      const strip = JSON.parse(
        await page.evaluate(`JSON.stringify({
          phase: document.getElementById('recording').dataset.phase,
          label: document.getElementById('rec-label').textContent,
          time: document.getElementById('rec-time').textContent,
          pause: document.getElementById('btn-pause').getAttribute('aria-label'),
          pressed: document.getElementById('btn-pause').getAttribute('aria-pressed'),
          mute: document.getElementById('btn-mute').getAttribute('aria-label'),
        })`),
      );
      // Paused 9 s ago, 83 s after the start: the time is frozen at 01:14.
      assert.deepEqual(strip, {
        phase: 'paused',
        label: 'Paused',
        time: '01:14',
        pause: 'Resume recording',
        pressed: 'true',
        mute: 'Unmute microphone',
      });
    }));

  await test('side panel: the countdown before a recording starts', () =>
    scene(openPage, '/sidepanel/sidepanel.html?demo=existing&rec=countdown', async (page) => {
      const strip = JSON.parse(
        await page.evaluate(`JSON.stringify({
          phase: document.getElementById('recording').dataset.phase,
          label: document.getElementById('rec-label').textContent,
          time: document.getElementById('rec-time').textContent,
          pauseDisabled: document.getElementById('btn-pause').disabled,
        })`),
      );
      assert.equal(strip.phase, 'countdown');
      assert.equal(strip.label, 'Starting in');
      assert.match(strip.time, /^\d+$/);
      assert.equal(strip.pauseDisabled, true, 'nothing to pause before the clip starts');
    }));

  await test('side panel: the countdown is on by default in the Record clip card', () =>
    scene(openPage, '/sidepanel/sidepanel.html?demo=new', async (page) => {
      assert.equal(await page.evaluate(`document.getElementById('rc-countdown').checked`), true);
    }));

  await test('side panel: the bubble stage drags and snaps, and the size buttons work', () =>
    scene(openPage, '/sidepanel/sidepanel.html?demo=new', async (page) => {
      const state = JSON.parse(
        await page.evaluate(`(async () => {
          const dot = document.querySelector('#rc-bubble .bubble-dot');
          const stage = dot.parentElement;
          const r = stage.getBoundingClientRect();
          const d0 = dot.getBoundingClientRect();
          const start = { x: d0.left + d0.width / 2, y: d0.top + d0.height / 2 };
          const ev = (type, x, y) => dot.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true }));
          ev('pointerdown', start.x, start.y);
          ev('pointermove', r.right - d0.width / 2 - 1, r.top + d0.height / 2 + 1); // near the top-right corner
          ev('pointerup', r.right - d0.width / 2 - 1, r.top + d0.height / 2 + 1);
          document.querySelector('#rc-bubble .bubble-size button[data-size="lg"]').click();
          await new Promise((res) => setTimeout(res, 50));
          const { prefs } = await chrome.storage.local.get('prefs');
          const d1 = dot.getBoundingClientRect();
          return JSON.stringify({
            saved: prefs.recorder.bubble,
            insideStage: d1.left >= r.left - 0.5 && d1.right <= r.right + 0.5 && d1.top >= r.top - 0.5 && d1.bottom <= r.bottom + 0.5,
            grew: d1.width > d0.width,
          });
        })()`),
      );
      assert.deepEqual(state.saved, { x: 1, y: 0, size: 'lg' }, 'snapped to the top-right corner, size L');
      assert.equal(state.insideStage, true);
      assert.equal(state.grew, true);
    }));

  for (const menu of ['source', 'resolution', 'mic', 'camera', 'shot']) {
    await test(`side panel: "${menu}" dropdown opens with options`, () =>
      scene(openPage, `/sidepanel/sidepanel.html?demo=menu&menu=${menu}`, async (page) => {
        const items = await page.evaluate(`document.querySelectorAll('.ms-menu:not([hidden]) li').length`);
        assert.ok(items >= 3, `expected an open menu with options, got ${items}`);
      }));
  }

  // Firefox variant (&browser=firefox fakes chrome.sidebarAction): the picker can't share a
  // single tab, and the sidebar must stay open while recording.
  await test('side panel (Firefox): the source menu has no "Current tab"', () =>
    scene(openPage, '/sidepanel/sidepanel.html?demo=menu&menu=source&browser=firefox', async (page) => {
      const labels = JSON.parse(
        await page.evaluate(`JSON.stringify([...document.querySelectorAll('.ms-menu:not([hidden]) li')].map((li) => li.textContent.trim()))`),
      );
      assert.equal(labels.length, 2, `expected Entire screen + Window, got ${JSON.stringify(labels)}`);
      assert.ok(!labels.some((l) => /Current tab/.test(l)), `Current tab offered on Firefox: ${JSON.stringify(labels)}`);
    }));

  await test('side panel (Firefox): the mid-recording note says to keep the sidebar open', () =>
    scene(openPage, '/sidepanel/sidepanel.html?demo=existing&browser=firefox', async (page) => {
      assert.equal(await page.evaluate(`document.getElementById('recording').hidden`), false);
      assert.match(await page.evaluate(`document.getElementById('rec-note').textContent`), /Keep this sidebar open/);
      assert.match(await page.evaluate(`document.getElementById('tool-shot').textContent`), /Screenshot/);
    }));

  // Regression guard: the toolbar once spilled "Screenshot" out of its button at ~340px, and
  // labels got truncated on Linux, whose UI fonts are wider than Windows' Segoe UI. Verdana is
  // a deliberately wide font, so it stands in for the widest system font on any OS.
  // The Firefox mid-recording scene adds the "keep this sidebar open" note and drops a source;
  // the Clips scene has the three-tab row with its third tab selected and the explainer.
  // The paused and countdown strips have the widest labels and both icon buttons.
  const LAYOUT_SCENES = ['new', 'existing&browser=firefox', 'existing&rec=paused', 'existing&rec=countdown', 'clips'];
  for (const font of ['system', 'wide (Verdana)']) {
    for (const demo of LAYOUT_SCENES) {
    await test(`side panel: nothing overflows or gets clipped at narrow widths — ${font} font, ${demo}`, async () => {
      for (const width of [420, 400, 380, 360, 340, 320, 300, 280, 260]) {
        await scene(
          openPage,
          `/sidepanel/sidepanel.html?demo=${demo}`,
          async (page) => {
            if (font !== 'system') {
              await page.evaluate(`document.head.insertAdjacentHTML('beforeend',
                '<style>body, button, input, select, textarea { font-family: Verdana, sans-serif !important; }</style>')`);
            }
            await assertNoLayoutProblems(page, width);
          },
          { width },
        );
      }
    });
    }
  }

  async function assertNoLayoutProblems(page, width) {
    const problems = JSON.parse(
      await page.evaluate(`JSON.stringify([
        // Sticks out past the panel's edge
        ...[...document.querySelectorAll('.tabs, .tab, #panel-clips, .clips-intro, .clips-auto, #location, .loc-change, .toolbar-wrap, .tool-btn, .record-card, .rc-row, .bubble-ctl, .bubble-stage, .bubble-size, .rec-bubble, .attachment, .app-header, .recording, #rec-note, #rec-time, .rec-ctl, #btn-stop, .rc-countdown, .rte, .rte-btn, .rte-block')]
          .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
          .map((el) => 'past edge: ' + (el.id || el.className)),
        // Content wider than its own button (spills out, or gets cut off)
        ...[...document.querySelectorAll('.tool-btn, .tab')]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => 'clipped: ' + el.textContent.trim()),
        // Visible labels must be shown in full, not truncated to "Screensh…" or "Existing t…"
        // (icon-only mode hides them entirely, which is fine)
        ...[...document.querySelectorAll('.tool-label, .tab-label')]
          .filter((el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1)
          .map((el) => 'truncated label: ' + el.textContent.trim()),
      ])`),
    );
    assert.deepEqual(problems, [], `layout problems at ${width}px`);
  }

  // The camera-bubble compositor on two canvas streams: it must draw the screen, the bubble where
  // the layout says, follow a setLayout() mid-recording, and feed MediaRecorder real frames.
  await test('compositor: draws the bubble over the screen and records', () =>
    scene(
      openPage,
      '/tests/smoke/compositor.html',
      async (page) => {
        const r = JSON.parse(await page.evaluate(`JSON.stringify(window.__result)`));
        assert.ok(r, 'the page produced no result');
        assert.deepEqual([r.w, r.h], [640, 360], 'the canvas follows the screen size');
        assert.ok(r.bytes > 0, 'MediaRecorder got no data');
        assert.equal(r.sinkWidth, 640, 'the output track delivered no frames (requestFrame not wired?)');
        if (r.framesSeen >= 0) assert.ok(r.framesSeen >= 10, `expected a steady frame flow, saw ${r.framesSeen} frames in ~1.5 s`);
        const isBlue = ([red, g, b]) => b > 150 && red < 80 && g < 100;
        const isOrange = ([red, g, b]) => red > 180 && g > 120 && b < 80;
        assert.ok(isBlue(r.centre), `screen expected in the middle, got ${r.centre}`);
        assert.ok(isOrange(r.topLeftBubble), `camera expected in the bubble after the move, got ${r.topLeftBubble}`);
        assert.ok(isBlue(r.bottomRight), `screen expected where the bubble used to be, got ${r.bottomRight}`);
      },
      { width: 800, height: 600 },
    ));

  // The full-size attachment tab: reads IndexedDB and shows the file, or says it is gone.
  // Each openPage() gets its own browser context (own IndexedDB), so the happy path loads the
  // viewer in an iframe of the same page after saving a record there.
  await test('viewer: a clear message for a missing attachment, the file itself for a saved one', () =>
    scene(
      openPage,
      '/viewer/viewer.html?id=424242',
      async (page) => {
        assert.match(await page.evaluate(`document.querySelector('#main .notice')?.textContent || ''`), /no longer available/);
        // Branded like the rest of the extension: coffee button, landing page, privacy policy.
        const links = JSON.parse(
          await page.evaluate(`JSON.stringify({
            coffee: document.querySelector('.bmc-button[data-link="coffee"]').href,
            site: document.querySelector('a.brand').href,
            privacy: document.querySelector('[data-link="privacy"]').href,
            hidden: [...document.querySelectorAll('[data-link]')].filter((a) => a.hidden).length,
          })`),
        );
        assert.match(links.coffee, /buymeacoffee\.com/);
        assert.match(links.site, /clickup-uploader\.macawshub\.com/);
        assert.match(links.privacy, /privacy-policy\.html$/);
        assert.equal(links.hidden, 0);
        const state = JSON.parse(
          await page.evaluate(`(async () => {
            const db = await import('/lib/attachments-db.js');
            const canvas = document.createElement('canvas');
            canvas.width = 40; canvas.height = 30;
            const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
            const id = await db.saveAttachment(new File([blob], 'shot.png', { type: 'image/png' }));
            const frame = document.createElement('iframe');
            frame.src = '/viewer/viewer.html?id=' + id;
            document.body.append(frame);
            const doc = await new Promise((resolve, reject) => {
              const end = Date.now() + 8000;
              const poll = () => {
                const w = frame.contentWindow;
                if (w && w.__ready) return resolve(w.document);
                if (Date.now() > end) return reject(new Error('viewer iframe never got ready'));
                setTimeout(poll, 50);
              };
              frame.addEventListener('load', poll);
            });
            return JSON.stringify({
              id,
              name: doc.getElementById('name').textContent,
              img: !!doc.querySelector('#main img'),
              error: doc.querySelector('#main .notice')?.textContent || '',
              download: doc.getElementById('download').download,
            });
          })()`),
        );
        assert.ok(state.id > 0);
        assert.deepEqual(
          { name: state.name, img: state.img, error: state.error, download: state.download },
          { name: 'shot.png', img: true, error: '', download: 'shot.png' },
        );

        // A video gets the 1× / 1.5× / 2× speed buttons (an image doesn't). The bytes needn't
        // decode: playbackRate is set on the element either way.
        const speed = JSON.parse(
          await page.evaluate(`(async () => {
            const db = await import('/lib/attachments-db.js');
            const id = await db.saveAttachment(new File(['not really webm'], 'clip.webm', { type: 'video/webm' }));
            const frame = document.createElement('iframe');
            frame.src = '/viewer/viewer.html?id=' + id;
            document.body.append(frame);
            const doc = await new Promise((resolve, reject) => {
              const end = Date.now() + 8000;
              const poll = () => {
                const w = frame.contentWindow;
                if (w && w.__ready) return resolve(w.document);
                if (Date.now() > end) return reject(new Error('viewer iframe never got ready'));
                setTimeout(poll, 50);
              };
              frame.addEventListener('load', poll);
            });
            const before = doc.querySelector('#speed button[aria-pressed="true"]')?.textContent;
            doc.querySelector('#speed button[data-speed="2"]').click();
            await new Promise((r) => setTimeout(r, 50)); // ratechange is async
            return JSON.stringify({
              shown: !doc.getElementById('speed').hidden,
              before,
              rate: doc.querySelector('#main video').playbackRate,
              pressed: [...doc.querySelectorAll('#speed button[aria-pressed="true"]')].map((b) => b.textContent),
            });
          })()`),
        );
        assert.deepEqual(speed, { shown: true, before: '1×', rate: 2, pressed: ['2×'] });
      },
      { width: 900, height: 700 },
    ));

  await test('editor: annotations, blur and crop render without errors', () =>
    scene(
      openPage,
      '/store/src/editor-demo.html',
      async (page) => {
        const undoEnabled = await page.evaluate(`!document.getElementById('editor').contentDocument.getElementById('undo').disabled`);
        assert.equal(undoEnabled, true, 'expected the demo annotations to be on the undo stack');
      },
      { width: 1280, height: 800 },
    ));

  await test('settings: saved token is masked and the coffee button is shown', () =>
    scene(
      openPage,
      '/options/options.html?demo=settings',
      async (page) => {
        assert.equal(await page.evaluate(`document.getElementById('saved').hidden`), false);
        assert.equal(await page.evaluate(`document.querySelector('.coffee-box').hidden`), false);
        assert.match(await page.evaluate(`document.querySelector('[data-link="coffee"]').href`), /buymeacoffee\.com/);
      },
      { width: 640, height: 900 },
    ));
});
