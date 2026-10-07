// Smoke tests: load the real side panel, editor and settings page in headless Chrome with
// fake chrome.* / ClickUp APIs (store/src/demo-stub.js) and fail on any page error.
// Needs Chrome or Edge (set CHROME=/path if it isn't found). Run: npm run test:smoke
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
          attachments: document.querySelectorAll('.attachment').length,
          cardOpen: !document.getElementById('record-card').hidden,
          submit: document.getElementById('btn-submit').textContent,
        })`),
      );
      assert.deepEqual(state, { list: '1000', attachments: 2, cardOpen: true, submit: 'Create task & upload' });
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
    }));

  for (const menu of ['source', 'resolution', 'mic', 'shot']) {
    await test(`side panel: "${menu}" dropdown opens with options`, () =>
      scene(openPage, `/sidepanel/sidepanel.html?demo=menu&menu=${menu}`, async (page) => {
        const items = await page.evaluate(`document.querySelectorAll('.ms-menu:not([hidden]) li').length`);
        assert.ok(items >= 3, `expected an open menu with options, got ${items}`);
      }));
  }

  // Regression guard: the toolbar once spilled "Screenshot" out of its button at ~340px, and
  // labels got truncated on Linux, whose UI fonts are wider than Windows' Segoe UI. Verdana is
  // a deliberately wide font, so it stands in for the widest system font on any OS.
  for (const font of ['system', 'wide (Verdana)']) {
    await test(`side panel: nothing overflows or gets clipped at narrow widths — ${font} font`, async () => {
      for (const width of [420, 400, 380, 360, 340, 320, 300, 280, 260]) {
        await scene(
          openPage,
          '/sidepanel/sidepanel.html?demo=new',
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

  async function assertNoLayoutProblems(page, width) {
    const problems = JSON.parse(
      await page.evaluate(`JSON.stringify([
        // Sticks out past the panel's edge
        ...[...document.querySelectorAll('.toolbar-wrap, .tool-btn, .record-card, .rc-row, .attachment, .app-header')]
          .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
          .map((el) => 'past edge: ' + (el.id || el.className)),
        // Content wider than its own button (spills out, or gets cut off)
        ...[...document.querySelectorAll('.tool-btn')]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => 'clipped: ' + el.textContent.trim()),
        // Visible labels must be shown in full, not truncated to "Screensh…"
        // (icon-only mode hides them entirely, which is fine)
        ...[...document.querySelectorAll('.tool-label')]
          .filter((el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1)
          .map((el) => 'truncated label: ' + el.textContent.trim()),
      ])`),
    );
    assert.deepEqual(problems, [], `layout problems at ${width}px`);
  }

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
