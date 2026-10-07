# Video & Screenshot Uploader for ClickUp

A Chrome extension by **Wagih Elbedeawi**. Record your screen or capture and annotate screenshots, then attach them to a new or existing ClickUp task, all from Chrome's side panel. The official ClickUp extension can't attach videos.

*Not affiliated with, endorsed by or sponsored by ClickUp. "ClickUp" is a trademark of its owner, used only to describe compatibility.*

## Install for development (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pin the extension and click its icon. The side panel opens.

Requires Chrome 123 or later. After changing the manifest, click the reload icon on the extension's card.

## Set up your token

1. In ClickUp go to **Settings → Apps** (<https://app.clickup.com/settings/apps>) and copy your personal API token (`pk_...`).
2. Click ⚙ in the side panel (or open the extension's **Options**), paste the token, then **Save**. You should see "Connected as <your name>".

The token is kept in `chrome.storage.local` on this machine only. **Revoke** on the settings page removes it from the browser. To invalidate the token itself, regenerate it in ClickUp.

## Usage

**New task:** pick Workspace → Space → Folder (or "No folder") → List, enter a title and an optional Markdown description, status and priority. Then press **Create task & upload**.
- The panel opens on the list you used last.
- Each dropdown remembers your last pick inside each parent, and picks the only option automatically when there is just one.
- **More details** (collapsed by default) adds assignees, due date (optionally with a time), tags and custom fields. A badge shows how many are set.
- Supported custom field types: text, number, currency, email, URL, phone, date, checkbox, dropdown, labels and rating. Other types are listed so you can set them in ClickUp afterwards. Required fields are checked before submitting.

**Existing task:** open a task in ClickUp and the panel picks it up from the current tab. You can also paste a task URL, a task ID, or a custom ID like `DEV-123`, then press **Check**. **Add a comment** (collapsed) posts a comment after the upload. You can also post just a comment.

**Attachments**: a toolbar with three tools.
- **🎥 Record clip** opens the recording card:
  - **Source:** Entire screen, Window or Current tab. Chrome's share picker opens on the matching pane. Tick "Share audio" there to include system or tab audio.
  - **Resolution:** 720p (HD), 1080p (Full HD), 1440p (2K), 2160p (4K) or Native (Auto). The capture is scaled down to fit; bitrate follows the real size.
  - **Microphone:** "No microphone" or any of your devices, with a live level meter. Until the extension has mic permission, the list shows "Default microphone" and an option to allow access.

  Choices are remembered. Press **Record Clip** to start. You can **close the side panel while recording**: a red **REC** badge shows it's running. Stop with Chrome's "Stop sharing" bar, or reopen the panel and press **Stop**. Recordings are written to disk as they go, so long ones don't fill memory.
- **📷 Screenshot ▾** has three modes:
  - **Visible tab** captures the visible part of the current tab.
  - **Select area** lets you drag a rectangle on the page. Esc or a plain click cancels.
  - **Entire screen** captures a screen, window or tab via Chrome's picker.

  Each screenshot opens in an editor tab with **Draw**, **Text**, **Blur** (pixelates, safe for passwords and emails) and **Crop**. There are 8 colors, 3 sizes and undo/redo (Ctrl+Z / Ctrl+Shift+Z), with shortcuts P, T, B and C. An area selection opens already cropped; undo brings back the full screenshot.
- **📎 Attach** picks files. You can also drop or paste files (Ctrl+V) anywhere in the panel.
- Attachments you haven't uploaded are kept, even if you close the panel, until you upload or remove them.
- Recordings are WebM (VP9/Opus), which plays in ClickUp's viewer. ClickUp's limit is 1 GB per file.

If the task is created but an upload or the comment fails, the task link stays on screen and the button turns into **Retry**, so nothing is duplicated. Rate-limit responses (HTTP 429) are retried automatically.

### Microphone permission

Chrome usually can't show the microphone prompt inside a side panel. When that happens, the panel shows **Grant microphone access**. Click it, allow the mic in the tab that opens, then record again. You only need to do this once.

## Buy Me a Coffee link

The link is `BUY_ME_A_COFFEE_URL` in [lib/links.js](lib/links.js) (https://buymeacoffee.com/wagih.elbedeawi). It drives the compact button in the side panel footer and the "Support this extension" box in Settings; clearing it hides both. The button recreates Buy Me a Coffee's official style locally, because MV3 doesn't allow their remote widget script. The Cookie font is bundled in `fonts/` under the SIL Open Font License.

## Releasing

```
node scripts/render-assets.mjs   # regenerate icons/ and store/images/ (needs Chrome or Edge)
node scripts/package.mjs         # → dist/video-and-screenshot-uploader-for-clickup-<version>.zip
```

Then follow [store/listing.md](store/listing.md). It holds every field the Chrome Web Store dashboard asks for: description, permission justifications, data-usage answers and reviewer test steps. The privacy policy is in [store/privacy-policy.html](store/privacy-policy.html). Host it somewhere public first.

Bump `version` in `manifest.json` for each upload.

## Project layout

```
manifest.json           MV3 manifest
background.js           opens the side panel; starts/stops the offscreen recorder, REC badge
sidepanel/              main UI: sidepanel.js (form, uploads), recorder-card.js (Record clip),
                        details.js ("More details"), menu.js (dropdowns)
lib/icons.js            inline SVG icon set
offscreen/              hidden document that owns recordings and "Screen" screenshots
editor/                 screenshot annotation editor (draw, text, blur, crop)
options/                API token settings + revoke
permissions/            one-time microphone permission page
icons/                  extension icons (generated from store/src/icon.svg)
lib/clickup-api.js      ClickUp API v2 client (429 retries, XHR for upload progress)
lib/recorder.js         getDisplayMedia + mic → MediaRecorder (WebM), pluggable chunk sink
lib/attachments-db.js   IndexedDB: pending attachments, screenshot drafts, recording chunks
lib/screenshot.js       tab / area capture (injected area-selection overlay)
lib/storage.js          chrome.storage helpers
store/                  Web Store listing, privacy policy, images and their HTML sources
scripts/                asset renderer and zip packager (Node 22+, no dependencies)
```

No build step: edit a file, then click the reload icon on `chrome://extensions`.

## ClickUp API used

`GET /team`, `/team/{id}/space`, `/space/{id}/folder`, `/space/{id}/list`, `/folder/{id}/list`, `/list/{id}`, `/list/{id}/member`, `/list/{id}/field`, `/space/{id}/tag`, `/task/{id}`, `/user`.
`POST /list/{id}/task`, `/task/{id}/attachment`, `/task/{id}/comment`.
