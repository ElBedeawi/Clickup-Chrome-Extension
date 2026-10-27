# Firefox Add-ons (AMO) listing — copy/paste sheet

Everything the addons.mozilla.org Developer Hub asks for. The Chrome sheet is `store/listing.md`;
this one only lists what differs. Build the upload with `node scripts/package.mjs`, which writes
`dist/<name>-<version>-firefox.zip` (and `dist/firefox/`, unpacked, for `about:debugging`).

The Firefox manifest is derived from `manifest.json` by `scripts/lib/firefox-manifest.mjs`; a unit
test (`tests/unit/firefox-manifest.test.mjs`) checks that every permission below matches it.

- **Add-on ID** (`browser_specific_settings.gecko.id`, frozen after the first upload): `clickup-video-upload@elbedeawi.github.io`
- **Minimum Firefox version:** 128.0 (ESR)
- **Privacy policy:** https://clickup-uploader.macawshub.com/privacy-policy.html
- **Homepage:** https://github.com/ElBedeawi/Clickup-Chrome-Extension
- **Support email:** wagih.elbedeawi+clickupvideo-chrome-ext@gmail.com
- **License:** MIT
- **Source code upload:** not needed. Our own code is plain ES modules with no build step or minification;
  the only generated file is `manifest.json`. The only minified code (since 0.8.0) is Google MediaPipe in
  `vendor/mediapipe/`, an unmodified third-party release, which AMO accepts with links to its official source:
  the reviewer notes below give them, with every file's SHA-256.

---

## Describe Add-on

**Name** (AMO caps it at 30 characters, so it differs from the manifest name): Video Uploader for ClickUp
**Listing URL:** https://addons.mozilla.org/en-US/firefox/addon/video-uploader-for-clickup/ · edit: https://addons.mozilla.org/en-US/developers/addon/video-uploader-for-clickup/edit

**Summary** (max 250 chars):
Record your screen or capture and annotate screenshots, then attach them to a new or existing ClickUp task from the Firefox sidebar. Uses your own ClickUp API token; talks only to ClickUp.

**Description:** use the Chrome description from `store/listing.md` with these edits:
- "straight from Chrome's side panel" → "straight from the Firefox sidebar"
- "Record a clip of your entire screen, a window or a tab" → "Record a clip of your entire screen or a window"
  (Firefox's picker cannot share a single tab)
- "Keep recording with the side panel closed — a REC badge shows it's running" →
  "Keep the sidebar open while recording — a REC badge shows it's running, and Stop in the sidebar ends
  the clip. If the sidebar is closed, what was recorded so far is kept."
- "Needs you signed in to ClickUp in this browser" (Save to Clips) → "Needs you signed in to ClickUp in Firefox"
- After the first paragraph, add "Watch the 55-second tour: https://youtu.be/IYCYp5thhZE" (AMO has no promo-video
  field, so the store video is linked from the description instead)
- Section headings are wrapped in `**…**` (AMO renders that as bold), and the closing credit also links the
  repository: "Made by Wagih Elbedeawi. Open source (MIT): https://github.com/ElBedeawi/Clickup-Chrome-Extension"

**Categories** (AMO has no Productivity category): Photos, Music & Videos · Web Development
**Tags:** none — AMO only offers a fixed list (ad blocker, youtube, …) and nothing fits.
**Homepage:** https://clickup-uploader.macawshub.com/ · **Contributions URL:** https://buymeacoffee.com/wagih.elbedeawi
**Support website:** https://github.com/ElBedeawi/Clickup-Chrome-Extension

**Images:** `store/images/store-icon-128.png` as the add-on icon and `store/images/screenshot-{1..5}-*.png` as screenshots
(rendered in Chrome; the Firefox sidebar shows the same panel), with these captions:
1. Record your screen from the sidebar and attach the clip to a new ClickUp task
2. Annotate screenshots: draw, add text, blur sensitive details and crop
3. Format the description like in ClickUp, plus optional assignees, due date, tags and custom fields
4. Add to an existing task, detected from the open tab, with a comment
5. Or skip the task: the Clips tab saves recordings to your workspace's Clips Hub, with ClickUp's transcript

**Privacy policy field:** AMO wants the policy text, not just a URL. Paste a summary of `docs/privacy-policy.html`
(what is handled, that it stays on-device until uploaded, api.clickup.com as the only destination, no analytics)
followed by the link, and one sentence explaining the data-collection declaration.

---

## Permissions (shown to the user at install)

| Permission | Why |
|---|---|
| `storage` | Stores the user's ClickUp API token and last-used Workspace/Space/Folder/List locally, plus the current recording state and small signals between the extension's own pages (`storage.session`). |
| `scripting` | "Screenshot → Select area": injects a temporary selection overlay into the current tab so the user can drag a rectangle; removed as soon as the selection is made. Only runs when the user picks "Select area". Also, on "Save to Clips" in the optional Clips tab, runs a small packaged function in an open app.clickup.com tab that asks ClickUp for a short-lived session token (using the user's existing sign-in) so the recording can be saved to their Clips Hub, which the public API cannot do. Nothing else is read from that page. |
| `<all_urls>` (host permission) | The user can screenshot whatever page they are on: `tabs.captureVisibleTab` needs it for "Visible tab" / "Select area" and `scripting` needs it for the overlay. It is also what lets the sidebar read the active tab's URL (there is no `tabs` permission) to detect an open ClickUp task and prefill it, and it covers ClickUp's own hosts (`app.clickup.com`, `id.app.clickup.com`, the workspace's `*.clickup.com` API host) for the optional Clips tab ("Save to Clips"). Pages are captured only on an explicit click; nothing is read or sent otherwise. |
| `https://api.clickup.com/*` (host permission) | All task creation, uploads, comments and workspace lookups go to the ClickUp API, authenticated with the user's own token. |

Not requested on Firefox (Chrome-only): `sidePanel`, `offscreen`. The sidebar is declared with `sidebar_action`
and the recorder runs inside it, so no offscreen document is needed.

---

## Data collection (`gecko.data_collection_permissions`)

Declared as **required**, matching the Chrome Web Store "data usage" answers and the privacy policy:

| Category | What it covers here |
|---|---|
| `authenticationInfo` | The user's ClickUp personal API token. Stored in the browser only and sent exclusively to `api.clickup.com` with each request. Also, only when they use the Clips tab ("Save to Clips"), a short-lived ClickUp session token obtained from their existing sign-in (kept in memory; sent only to ClickUp's own hosts). |
| `websiteContent` | Screen recordings and screenshots the user explicitly captures (a recording may include the user's own camera picture as a bubble, if they chose a camera), uploaded to the user's own ClickUp task when they press Create/Upload. |

Nothing is sent to the developer or to any third party; there is no analytics, telemetry or remote code.
`has_previous_consent` is not set (new listing).

---

## Notes to reviewer

```
No credentials needed: use your own free ClickUp account.
1. Sign up free at https://clickup.com, then open https://app.clickup.com/settings/apps and click Generate to get a personal API token.
2. Click the toolbar icon to open the sidebar, click the gear (Settings), paste the token, Save.
3. Pick Workspace, Space and List, then enter a title.
4. Screenshot > Visible tab: draw or blur, then Attach.
5. Record clip: optionally pick a camera and "Medium blur" (the expand button next to it shows a large preview), then Record Clip, pick a screen or window, wait for the 3-second countdown, try Pause/Resume, then press Stop in the sidebar. (Keep the sidebar open while recording; Firefox's own "Stop Sharing" button does not reach sidebar pages.)
6. Click "Create task & upload".

Source: https://github.com/ElBedeawi/Clickup-Chrome-Extension — our own code is plain ES modules, no
build step or minification. manifest.json for Firefox is generated by scripts/lib/firefox-manifest.mjs
from the Chrome manifest; everything else is byte-identical.

Third-party library (the only minified code): vendor/mediapipe/ holds unmodified upstream files of
Google MediaPipe @mediapipe/tasks-vision 1.1.1 (Apache-2.0), used only for the optional camera-bubble
background blur (off by default; loaded only when the user picks Medium or High blur):
  vision_bundle.mjs, wasm/vision_wasm_internal.js, wasm/vision_wasm_internal.wasm
    from https://www.npmjs.com/package/@mediapipe/tasks-vision/v/1.1.1
    (byte-identical to https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/)
  models/selfie_segmenter.tflite from
    https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite
  Source code: https://github.com/google-ai-edge/mediapipe
  SHA-256 (also in vendor/mediapipe/VENDOR.json):
    a84921e02321e582484c1f8126d344b5f33b791fa09c640a52e20ee8632068f1  vision_bundle.mjs
    6522286aa32dd93eff17c3da002b0649516f87abfec7a80b5bfe5c9625caa5f8  wasm/vision_wasm_internal.js
    0e101a010e262ef8e78f22e3c95b60a9705fd06962753c9acd6356d9fb56b7bd  wasm/vision_wasm_internal.wasm
    191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b  models/selfie_segmenter.tflite
The CSP adds 'wasm-unsafe-eval' for that WebAssembly (no eval). The library has built-in usage
logging to https://odml.pa.googleapis.com/v1/log that cannot be switched off; it is blocked twice:
lib/background-blur.js refuses those fetches before they are made, and the CSP connect-src only
allows ClickUp (https://*.clickup.com). No data leaves the device.
```
