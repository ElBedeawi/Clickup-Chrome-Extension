# AGENTS.md

Guidance for AI coding agents (and humans) working on this repo. User-facing docs are in
[README.md](README.md); contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

## What this is

A Manifest V3 extension for Chrome and Firefox ("Video & Screenshot Uploader for ClickUp", by Wagih Elbedeawi).
From the browser's side panel / sidebar the user records the screen or captures and annotates screenshots, then
attaches them to a new or existing ClickUp task via the ClickUp API v2, using their own personal API token.

## Hard rules

- **No build step, no runtime dependencies.** Plain ES modules, HTML and CSS, loaded unpacked as-is. Dev tooling
  in `scripts/` and `tests/` uses only Node built-ins (Node 22+). Don't add npm packages. **One agreed exception:**
  Google MediaPipe `@mediapipe/tasks-vision` (Apache-2.0) for the camera-bubble background blur, vendored unmodified
  in `vendor/mediapipe/` (~14 MB: one SIMD wasm, its loader, `vision_bundle.mjs`, the selfie segmenter model). Never
  edit those files (AMO checks them; `.gitattributes` keeps them byte-exact); update them only with
  `node scripts/vendor-mediapipe.mjs` (pinned version, sha256s in `VENDOR.json`, verified by a unit test). Load it
  only when blur is on (`lib/background-blur.js`), never at startup.
- **No remote code.** MV3 and the Chrome Web Store forbid loading scripts from other sites. Bundle assets
  locally (e.g. the Cookie font in `fonts/`, OFL-licensed).
- **Network goes only to ClickUp.** Everything uses the public API at `https://api.clickup.com`, with one
  user-triggered exception: the Clips tab's "Save to Clips" (`lib/clickup-clips.js`, `sidepanel/clips-host.js`) talks to
  ClickUp's web-app API (`id.app.clickup.com` for a session token, the workspace's `frontdoor-*.clickup.com` host
  for the upload, found via the public shard handshake), because the public API cannot create Clips. Keep that
  code isolated and failing soft; never route anything else through it. No analytics, tracking or new endpoints. If the data
  handled changes, update `docs/privacy-policy.html` and the data-usage answers in `store/listing.md`.
  **The browser enforces it:** the manifest CSP is `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';
  connect-src 'self' data: blob: https://*.clickup.com` (a unit test pins it). Any new host needs a CSP change, and
  that is a red flag. MediaPipe's bundle has hard-wired usage logging to `odml.pa.googleapis.com`: besides the CSP,
  `installTelemetryGuard()` in `lib/background-blur.js` refuses those fetches before they are made. Keep both.
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
            card), bubble-stage.js (camera bubble position/size control, used in the card and the recording
            strip), details.js ("More details"), menu.js (custom dropdowns)
background.js   classic script (Chrome: service worker; Firefox: event page). Opens the panel / toggles the
                sidebar on icon click; stores the recording state its host reports and sets the badge ('…' countdown,
                REC, II paused); on Chrome drives the offscreen recorder
offscreen/      Chrome only: hidden document hosting the capture session (survives the panel closing)
editor/         screenshot annotation tab (draw/text/blur/crop); edits are an op list in image pixels,
                replayed on the original image, so undo is cheap and export is full resolution
viewer/         full-size view of a pending attachment in a tab (side panels can't go fullscreen); 1×/1.5×/2× for videos
options/        settings page: token save/test/revoke, Buy Me a Coffee box
permissions/    one-time microphone/camera permission page (`?device=`; side panels can't show the prompt)
lib/            clickup-api.js (API client, 429 retry, XHR uploads for progress), recorder.js,
                compositor.js (draws the screen + the camera bubble on a canvas whose captureStream() is what
                gets recorded; clocked by tick-worker.js), capture-session.js (recorder + IndexedDB glue shared by
                the offscreen doc and the Firefox sidebar, plus recovery of a recording whose sidebar was closed),
                recording-state.js (elapsed time / countdown / phase of the session `recording` snapshot),
                background-blur.js (camera-bubble background blur on MediaPipe's selfie segmenter: loads it GPU→CPU,
                segments the bubble crop at ≤15 Hz, draws blurred background + sharp person; fails closed: fully
                blurred until a mask exists, camera left out if it can't start) + blur-math.js (its pure helpers),
                platform.js (Chrome/Firefox detection and wording), screenshot.js (tab/area capture + injected
                area overlay), attachments-db.js (IndexedDB), storage.js, geometry.js (pure helpers, incl. the
                bubble placement), icons.js, links.js
vendor/         mediapipe/: the vendored MediaPipe files (see Hard rules), VENDOR.json (sources + sha256), LICENSE
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
| `rec:start` `{source, resolution, micDeviceId, cameraDeviceId, bubble, delayMs, blur}` | panel → background → offscreen | Chrome: start recording (offscreen shows the picker; `delayMs` is the countdown after it; `blur` is `none\|medium\|high`); answers `{ok, micError?, cameraError?, blurError?, camera, recording}` (`recording` = the session snapshot; `blurError` = blur couldn't start, so the camera was left out) |
| `rec:stop` | panel → background → offscreen | Chrome: stop; offscreen saves the file to IndexedDB first. During the countdown it cancels: `{ok, cancelled: true}`, no file |
| `rec:bubble` `{bubble}` | panel → background → offscreen (Chrome); sidebar → own session, or `target: 'host'` to the recording sidebar (Firefox) | move/resize the camera bubble of the running recording |
| `rec:pause` / `rec:resume` / `rec:mute` `{muted}` | same routes as `rec:bubble` | pause/resume the recording, mute/unmute its mic; the recorder's host then reports the new state with `rec:state` `update` |
| `rec:finished` `{error?}` | offscreen → background | Chrome: user ended sharing from the browser's own bar (or ended the countdown) |
| `shot:screen` | panel → background → offscreen | Chrome: "Entire screen" screenshot → returns `draftId` |
| `rec:state` `{recording, error?, update?}` | sidebar → background (Firefox); offscreen → background (Chrome, `update` only) | the recorder's host reports a full snapshot: Firefox sets it on start and clears it on stop; both send `update: true` when the countdown runs out and on pause/resume/mute, applied only if the stored `recording.id` matches. Background stores it and sets the badge |
| `rec:ping` / `rec:stop` (`target: 'host'`) | sidebar → recording sidebar | Firefox: "is anyone recording?" (answered while counting down, recording or paused) / stop it from another window |

**State**
- `chrome.storage.local`: `clickupToken`; `prefs` = `{ mode, last: {workspace, 'space:<team>', 'folder:<space>', 'list:<space>/<folder>'}, recorder: {source, resolution, mic, camera, bubble: {x, y, size}, countdown, blur}, clips: {autoSave, shards}, viewer: {speed} }`
  (`mode` is the destination tab used last, `new|existing|clips`; `camera` is `'none'` or a device id; `bubble.x/y`
  are 0–1 fractions of the area the bubble may occupy, so the corners are exactly 0/1 pairs; `size` is `sm|md|lg`;
  `countdown` is the "3-second countdown" checkbox, on unless `false`, and is written with the rest of `recorder` by
  `recorder-card.js`; `blur` is the camera bubble's background blur, `none|medium|high` (default `none`; the card
  resets it to `none` if the segmenter can't load on this device); `clips.autoSave` is the "Save to Clips when recording stops" toggle and `clips.shards` the
  per-workspace API host cache, written only through `setClipsPrefs()` because `setPrefs` merges one level deep;
  `viewer.speed` is the viewer tab's last playback speed, `1|1.5|2`).
- `chrome.storage.session`: `recording` while recording, the panel mirrors it: `{id, startedAt, camera, mic, pausedAt,
  pausedMs, micMuted, blur}` as reported by the recorder's host (`startedAt` is in the future during the countdown;
  `pausedAt` is set while paused; `pausedMs` sums the earlier pauses; read it with `lib/recording-state.js`), `recordingError`,
  `attachmentsChangedAt` (bumped to make an open panel re-read IndexedDB), `micGrantedAt` / `cameraGrantedAt` (bumped by
  the permission helper page so an open panel re-reads the device list).
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
- **The offscreen document is never rendered**: `requestAnimationFrame` doesn't fire there and main-thread timers
  can be throttled, so the camera-bubble compositor is clocked by a dedicated worker (`lib/tick-worker.js`) and
  pushes frames with `canvas.captureStream(0)` + `requestFrame()`. The worker must be a real file: the fixed MV3
  CSP (`script-src 'self'`) blocks `blob:` workers.
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
- **MediaPipe needs WebGL even with its CPU delegate** (it uploads frames as textures). Headless Chrome only has it
  with `--enable-unsafe-swiftshader` (set in `scripts/lib/headless.mjs`); without WebGL, blur is unavailable and the
  card says so. Its VIDEO mode wants strictly increasing timestamps; `segmentForVideo` is synchronous (main thread,
  ≤15 Hz). The bundle reads, then clears, `self.Module`: `loadSegmenter()` sets `print`/`printErr` to
  `console.debug` so its log lines aren't console errors (the smoke harness fails on those). Browser built-in blur
  (`backgroundBlur` constraint) wasn't an option: only Windows with Studio Effects lets a page toggle it, macOS and
  ChromeOS are read-only, Firefox has none, and it has no levels.
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

The store promo video (the Chrome Web Store "Global promo video", hosted on YouTube) is a separate
[HyperFrames](https://github.com/heygen-com/hyperframes) project in `store/promo-video/` (`BRIEF.md` → `STORYBOARD.md` +
`SCRIPT.md` → `compositions/frames/*.html` → `index.html`). It is not part of the extension and installs nothing in the
repo: render it with `cd store/promo-video && npx hyperframes render --quality high --output renders/video.mp4`
(needs Node 22+, FFmpeg on PATH, Chrome; the narration is local Kokoro TTS via `hyperframes tts`, no music). Rendered
files and `.hyperframes/` are git-ignored.

Headless scripts find Chrome/Edge and Firefox automatically (set `CHROME=/path` / `FIREFOX=/path` otherwise). Demo
pages: any URL with `?demo=<scene>` gets `store/src/demo-shared.js` + `demo-stub.js` injected, which fake `chrome.*`
and the ClickUp API (scenes: `new`, `details`, `existing`, `clips`, `menu&menu=<source|resolution|mic|shot>`, `editor`);
add `&browser=firefox` to fake Firefox's `chrome.sidebarAction` and get the sidebar variant of the UI, and
`&rec=paused` / `&rec=countdown` to `existing` for the other recording-strip states, `&cam=1` for a fake camera with
camera/mic access granted (the bubble preview runs, blur included), and `&open=camera-check` to open the Camera check
dialog (the big preview, `#camera-check` in `sidepanel.html`, driven by `recorder-card.js`).

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
  https://clickup-uploader.macawshub.com/privacy-policy.html
- Chrome Web Store item ID: `oljdlfoinjjdjddnaedcppfhgflkgpoa`
- Firefox add-on ID (`gecko.id`): `clickup-video-upload@elbedeawi.github.io` · AMO Developer Hub: https://addons.mozilla.org/developers/
