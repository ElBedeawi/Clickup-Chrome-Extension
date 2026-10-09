# AGENTS.md

Guidance for AI coding agents (and humans) working on this repo. User-facing docs are in
[README.md](README.md); contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

## What this is

A Manifest V3 extension for Chrome and Firefox ("Video & Screenshot Uploader for ClickUp", by Wagih Elbedeawi).
From the browser's side panel / sidebar the user records the screen or captures and annotates screenshots, then
attaches them to a new or existing ClickUp task via the ClickUp API v2, using their own personal API token.

## Hard rules

- **No build step, no runtime dependencies.** Plain ES modules, HTML and CSS, loaded unpacked as-is. Dev tooling
  in `scripts/` and `tests/` uses only Node built-ins (Node 22+). Don't add npm packages.
- **No remote code.** MV3 and the Chrome Web Store forbid loading scripts from other sites. Bundle assets
  locally (e.g. the Cookie font in `fonts/`, OFL-licensed).
- **Network goes only to `https://api.clickup.com`.** No analytics, tracking or new endpoints. If the data
  handled changes, update `docs/privacy-policy.html` and the data-usage answers in `store/listing.md`.
- **Permissions are minimal and justified.** Every permission in `manifest.json` must have a justification in
  `store/listing.md`, and every one in the derived Firefox manifest in `store/firefox-listing.md` (unit tests
  enforce both). Adding one slows store review.
- **One codebase for both browsers.** `manifest.json` is Chrome's and the repo loads unpacked in Chrome as-is;
  `scripts/lib/firefox-manifest.mjs` derives the Firefox manifest at package time. Code uses `chrome.*` everywhere
  (Firefox returns promises for it in MV3); browser differences go through `lib/platform.js` (feature detection,
  never UA sniffing). The `gecko.id` in the Firefox manifest is frozen by AMO: never change it.
- **Check UI changes at narrow side-panel widths** (320px and 260px), not just ~400px. Long text in grid/flex
  items needs `min-width: 0` / `minmax(0, …)` + ellipsis. Leave room for **wider system fonts**: Linux/macOS UI
  fonts are wider than Windows' Segoe UI (CI on Linux caught labels truncating at 360px). The smoke test checks
  9 widths with both the system font and Verdana for overflow and truncated labels.

## Architecture

```
sidepanel/  UI. sidepanel.js (form, uploads, wiring, recorder host selection), recorder-card.js ("Record clip"
            card), details.js ("More details"), menu.js (custom dropdowns)
background.js   classic script (Chrome: service worker; Firefox: event page). Opens the panel / toggles the
                sidebar on icon click; owns the recording state + REC badge; on Chrome drives the offscreen recorder
offscreen/      Chrome only: hidden document hosting the capture session (survives the panel closing)
editor/         screenshot annotation tab (draw/text/blur/crop); edits are an op list in image pixels,
                replayed on the original image, so undo is cheap and export is full resolution
options/        settings page: token save/test/revoke, Buy Me a Coffee box
permissions/    one-time microphone permission page (side panels can't show the prompt)
lib/            clickup-api.js (API client, 429 retry, XHR uploads for progress), recorder.js,
                capture-session.js (recorder + IndexedDB glue shared by the offscreen doc and the Firefox sidebar,
                plus recovery of a recording whose sidebar was closed), platform.js (Chrome/Firefox detection and
                wording), screenshot.js (tab/area capture + injected area overlay), attachments-db.js (IndexedDB),
                storage.js, geometry.js (pure helpers), icons.js, links.js
scripts/lib/    firefox-manifest.mjs (Chrome manifest → Firefox manifest), headless.mjs (Chrome via CDP, Firefox via
                WebDriver BiDi, same openPage() contract)
```

**Recorder host.** Chrome: offscreen document, messages via background. Firefox: the sidebar page itself
(`createLocalHost()` in `sidepanel.js`), because Firefox has no offscreen documents and its event page is unloaded
after a few idle seconds regardless of an active `MediaRecorder`. `getDisplayMedia` there needs the click's transient
activation, so the Firefox start path must not await the background first. Closing the sidebar kills the recorder;
the chunks already on disk are turned into an attachment by `recoverInterruptedRecording` on the next open, after a
`rec:ping` confirms no sidebar in another window is still recording.

**Messages** (`chrome.runtime.sendMessage`, routed by a `target` field: `'background'`, `'offscreen'` or `'host'`):

| type | from → to | purpose |
|---|---|---|
| `rec:start` `{source, resolution, micDeviceId}` | panel → background → offscreen | Chrome: start recording (offscreen shows the picker) |
| `rec:stop` | panel → background → offscreen | Chrome: stop; offscreen saves the file to IndexedDB first |
| `rec:finished` `{error?}` | offscreen → background | Chrome: user ended sharing from the browser's own bar |
| `shot:screen` | panel → background → offscreen | Chrome: "Entire screen" screenshot → returns `draftId` |
| `rec:state` `{recording, error?}` | sidebar → background | Firefox: the sidebar started/stopped recording; background updates session state + badge |
| `rec:ping` / `rec:stop` (`target: 'host'`) | sidebar → recording sidebar | Firefox: "is anyone recording?" (answered only while recording) / stop it from another window |

**State**
- `chrome.storage.local`: `clickupToken`; `prefs` = `{ last: {workspace, 'space:<team>', 'folder:<space>', 'list:<space>/<folder>'}, recorder: {source, resolution, mic} }`.
- `chrome.storage.session`: `recording` (`{startedAt}` while recording; the panel mirrors it), `recordingError`,
  `attachmentsChangedAt` (bumped to make an open panel re-read IndexedDB), `micGrantedAt` (bumped by the mic helper
  page so an open panel re-reads the device list).
- IndexedDB `clickup-video-upload` v2: store `recordings` (any pending attachment: `{id, file, createdAt, draft?, crop?}`;
  `draft: true` = screenshot still open in the editor, ignored by the panel, purged after 24h) and store `chunks`
  (the in-progress recording, written as it goes and assembled on stop).

## Platform constraints we learned the hard way

- **Side panels can't show permission prompts** (microphone, `permissions.request`). Hence the mic helper tab and
  `<all_urls>` declared up front rather than requested at runtime.
- **`chrome.tabCapture` doesn't work from the side panel** ("Extension has not been invoked for the current page").
  "Current tab" recording therefore uses `getDisplayMedia` with `displaySurface: 'browser'` (picker preselected).
- **On Chrome the recorder must live in the offscreen document** (reasons `DISPLAY_MEDIA`, `USER_MEDIA`); a side
  panel is destroyed when closed.
- **Firefox has no `sidePanel`, no `offscreen`, and its MV3 background is an event page** that is unloaded after a
  few idle seconds (timers, ports and DOM work don't keep it alive). Its `sidebar_action` sidebar is per window,
  survives tab switches, and is destroyed when closed. Its share picker ignores `displaySurface`, cannot share a
  single tab and provides no system audio. `options_page` is Chrome-only (`options_ui` instead). Host permissions
  are granted in the install prompt since Firefox 127, and users can revoke them per site in `about:addons`.
- **Firefox's sharing indicator can't stop a sidebar's capture.** Its "Stop Sharing" button neither ends the
  track nor dismisses the indicator for a `moz-extension` sidebar document (verified in Firefox 147), so on
  Firefox the panel's Stop button is the only way to end a clip. The recorder still finalises on the
  recorder's own `stop` event in case the track does end (Chrome's bar, or a future Firefox fix).
- **Firefox blobs read from IndexedDB die with their records.** A File assembled from the `chunks` store is only
  readable while those records exist (Chrome keeps the data alive). So: store the assembled File first, then
  `sink.release()` the chunks; never clear before saving. The stored copy survives the clear.
- **AMO requires** a fixed `gecko.id`, `strict_min_version` ≥ 128 and `data_collection_permissions` (new
  submissions since Nov 2025); every build must be signed by AMO, even for self-distribution.
- **ClickUp personal tokens go in `Authorization` as-is** (no `Bearer`). Custom task IDs need
  `custom_task_ids=true&team_id=…`. Custom field value formats: see `sidepanel/details.js` and ClickUp's docs.
- **Google blocks sign-in in automated browsers**, so automating the Web Store dashboard needs the user's real
  Chrome (chrome-devtools-mcp `--autoConnect` with remote debugging enabled at `chrome://inspect/#remote-debugging`).

## Commands

```
npm test                    # unit tests (node:test) — fast, no browser
npm run test:smoke          # headless Chrome: real UI against demo data, fails on any page error
npm run test:smoke:firefox  # the same scenes in headless Firefox (WebDriver BiDi)
npm run render              # regenerate icons/ and store/images/ from store/src/ (Chrome only)
npm run package             # dist/<name>-<version>.zip (Chrome), dist/<name>-<version>-firefox.zip, dist/firefox/ (unpacked)
```

Headless scripts find Chrome/Edge and Firefox automatically (set `CHROME=/path` / `FIREFOX=/path` otherwise). Demo
pages: any URL with `?demo=<scene>` gets `store/src/demo-shared.js` + `demo-stub.js` injected, which fake `chrome.*`
and the ClickUp API (scenes: `new`, `details`, `existing`, `menu&menu=<source|resolution|mic|shot>`, `editor`);
add `&browser=firefox` to fake Firefox's `chrome.sidebarAction` and get the sidebar variant of the UI.

## Making changes

- Keep pure logic in `lib/` free of DOM/chrome access at import time so it stays unit-testable.
- New behavior → add a unit test (`tests/unit/`) or extend a smoke scene (`tests/smoke/ui.test.mjs`).
- UI change → run `npm run test:smoke` and `npm run test:smoke:firefox`; if it shows up in store screenshots,
  `npm run render` and review the PNGs. User-facing text must not say "Chrome" unless it is about Chrome; use
  `browserName()` and friends from `lib/platform.js`.
- Anything touching recording on Firefox needs a manual check in a real Firefox (`dist/firefox/` via
  `about:debugging`): the picker, stopping from Firefox's sharing indicator, closing the sidebar mid-recording,
  and a second window's sidebar while the first records. See the checklist in CONTRIBUTING.md.
- User-visible change → `CHANGELOG.md` under **Unreleased**.
- Release → bump `manifest.json` `version`, move the changelog section, `npm run package`, tag + GitHub release with
  both zips, upload the Chrome zip to the Web Store (`store/listing.md`) and the Firefox zip to AMO
  (`store/firefox-listing.md`).

## Links

- Repo: https://github.com/ElBedeawi/Clickup-Chrome-Extension · Privacy policy (GitHub Pages from `docs/`):
  https://elbedeawi.github.io/Clickup-Chrome-Extension/privacy-policy.html
- Chrome Web Store item ID: `oljdlfoinjjdjddnaedcppfhgflkgpoa`
- Firefox add-on ID (`gecko.id`): `clickup-video-upload@elbedeawi.github.io` · AMO Developer Hub: https://addons.mozilla.org/developers/
