# AGENTS.md

Guidance for AI coding agents (and humans) working on this repo. User-facing docs are in
[README.md](README.md); contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

## What this is

A Manifest V3 Chrome extension ("Video & Screenshot Uploader for ClickUp", by Wagih Elbedeawi). From Chrome's
side panel the user records the screen or captures and annotates screenshots, then attaches them to a new or
existing ClickUp task via the ClickUp API v2, using their own personal API token.

## Hard rules

- **No build step, no runtime dependencies.** Plain ES modules, HTML and CSS, loaded unpacked as-is. Dev tooling
  in `scripts/` and `tests/` uses only Node built-ins (Node 22+). Don't add npm packages.
- **No remote code.** MV3 and the Chrome Web Store forbid loading scripts from other sites. Bundle assets
  locally (e.g. the Cookie font in `fonts/`, OFL-licensed).
- **Network goes only to `https://api.clickup.com`.** No analytics, tracking or new endpoints. If the data
  handled changes, update `docs/privacy-policy.html` and the data-usage answers in `store/listing.md`.
- **Permissions are minimal and justified.** Every permission in `manifest.json` must have a justification in
  `store/listing.md` (a unit test enforces this). Adding one slows store review.
- **Check UI changes at narrow side-panel widths** (320px and 260px), not just ~400px. Long text in grid/flex
  items needs `min-width: 0` / `minmax(0, …)` + ellipsis. Leave room for **wider system fonts**: Linux/macOS UI
  fonts are wider than Windows' Segoe UI (CI on Linux caught labels truncating at 360px). The smoke test checks
  9 widths with both the system font and Verdana for overflow and truncated labels.

## Architecture

```
sidepanel/  UI. sidepanel.js (form, uploads, wiring), recorder-card.js ("Record clip" card),
            details.js ("More details"), menu.js (custom dropdowns)
background.js   service worker: opens the panel on icon click; coordinates the offscreen recorder; REC badge
offscreen/      hidden document that owns getDisplayMedia/MediaRecorder (survives the panel closing)
editor/         screenshot annotation tab (draw/text/blur/crop); edits are an op list in image pixels,
                replayed on the original image, so undo is cheap and export is full resolution
options/        settings page: token save/test/revoke, Buy Me a Coffee box
permissions/    one-time microphone permission page (side panels can't show the prompt)
lib/            clickup-api.js (API client, 429 retry, XHR uploads for progress), recorder.js,
                screenshot.js (tab/area capture + injected area overlay), attachments-db.js (IndexedDB),
                storage.js, geometry.js (pure helpers), icons.js, links.js
```

**Messages** (`chrome.runtime.sendMessage`, routed by a `target` field: `'background'` or `'offscreen'`):

| type | from → to | purpose |
|---|---|---|
| `rec:start` `{source, resolution, micDeviceId}` | panel → background → offscreen | start recording (offscreen shows Chrome's picker) |
| `rec:stop` | panel → background → offscreen | stop; offscreen saves the file to IndexedDB first |
| `rec:finished` `{error?}` | offscreen → background | user ended sharing from Chrome's own bar |
| `shot:screen` | panel → background → offscreen | "Entire screen" screenshot → returns `draftId` |

**State**
- `chrome.storage.local`: `clickupToken`; `prefs` = `{ last: {workspace, 'space:<team>', 'folder:<space>', 'list:<space>/<folder>'}, recorder: {source, resolution, mic} }`.
- `chrome.storage.session`: `recording` (`{startedAt}` while recording; the panel mirrors it), `recordingError`,
  `attachmentsChangedAt` (bumped to make an open panel re-read IndexedDB).
- IndexedDB `clickup-video-upload` v2: store `recordings` (any pending attachment: `{id, file, createdAt, draft?, crop?}`;
  `draft: true` = screenshot still open in the editor, ignored by the panel, purged after 24h) and store `chunks`
  (the in-progress recording, written as it goes and assembled on stop).

## Platform constraints we learned the hard way

- **Side panels can't show permission prompts** (microphone, `permissions.request`). Hence the mic helper tab and
  `<all_urls>` declared up front rather than requested at runtime.
- **`chrome.tabCapture` doesn't work from the side panel** ("Extension has not been invoked for the current page").
  "Current tab" recording therefore uses `getDisplayMedia` with `displaySurface: 'browser'` (picker preselected).
- **The recorder must live in the offscreen document** (reasons `DISPLAY_MEDIA`, `USER_MEDIA`); a side panel
  is destroyed when closed.
- **ClickUp personal tokens go in `Authorization` as-is** (no `Bearer`). Custom task IDs need
  `custom_task_ids=true&team_id=…`. Custom field value formats: see `sidepanel/details.js` and ClickUp's docs.
- **Google blocks sign-in in automated browsers**, so automating the Web Store dashboard needs the user's real
  Chrome (chrome-devtools-mcp `--autoConnect` with remote debugging enabled at `chrome://inspect/#remote-debugging`).

## Commands

```
npm test              # unit tests (node:test) — fast, no browser
npm run test:smoke    # headless Chrome: real UI against demo data, fails on any page error
npm run render        # regenerate icons/ and store/images/ from store/src/
npm run package       # dist/<name>-<version>.zip for the Web Store / GitHub release
```

Headless scripts find Chrome/Edge automatically (set `CHROME=/path` otherwise). Demo pages: any URL with
`?demo=<scene>` gets `store/src/demo-shared.js` + `demo-stub.js` injected, which fake `chrome.*` and the ClickUp API
(scenes: `new`, `details`, `existing`, `menu&menu=<source|resolution|mic|shot>`, `editor`).

## Making changes

- Keep pure logic in `lib/` free of DOM/chrome access at import time so it stays unit-testable.
- New behavior → add a unit test (`tests/unit/`) or extend a smoke scene (`tests/smoke/ui.test.mjs`).
- UI change → run `npm run test:smoke`; if it shows up in store screenshots, `npm run render` and review the PNGs.
- User-visible change → `CHANGELOG.md` under **Unreleased**.
- Release → bump `manifest.json` `version`, move the changelog section, `npm run package`, tag + GitHub release with
  the zip, upload the same zip to the Web Store. Listing copy for every dashboard field is in `store/listing.md`.

## Links

- Repo: https://github.com/ElBedeawi/Clickup-Chrome-Extension · Privacy policy (GitHub Pages from `docs/`):
  https://elbedeawi.github.io/Clickup-Chrome-Extension/privacy-policy.html
- Chrome Web Store item ID: `oljdlfoinjjdjddnaedcppfhgflkgpoa`
