# ClickUp Video Upload (Chrome extension)

A Chrome extension that creates ClickUp tasks, or targets an existing one, and attaches **screen recordings**, images and files to them. The official ClickUp extension can't attach videos.

Everything runs in Chrome's side panel, so it stays open while you switch tabs and record.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pin the extension and click its icon. The side panel opens.

Requires Chrome 116 or later.

## Set up your token

1. In ClickUp go to **Settings → Apps** (<https://app.clickup.com/settings/apps>) and copy your personal API token (`pk_...`).
2. Click ⚙ in the side panel (or open the extension's **Options**), paste the token, then **Save**.
   You should see "Connected as <your name>".

The token is kept in `chrome.storage.local` on this machine only. **Revoke** on the settings page removes it from the browser. To invalidate the token itself, regenerate it in ClickUp.

## Usage

**New task:** pick Workspace → Space → Folder (or "No folder") → List, enter a title and an optional Markdown description, status and priority. Add attachments, then press **Create task & upload**.
The panel opens on the list you used last. Each dropdown also remembers your last pick inside each parent, so switching workspace or space jumps straight to the list you last used there. A list is picked automatically when it's the only one.

**Existing task:** open a task in ClickUp and the side panel fills in the task from the current tab. You can also paste a task URL, a task ID, or a custom ID like `DEV-123`. Press **Check** to confirm it, then **Upload to task**.

**Attachments**
- **Record screen** asks you to pick a screen, window or tab. Tick "Share audio" in Chrome's picker to include system or tab audio. The **Microphone** checkbox mixes in your voice.
  You can **close the side panel while recording**. A red **REC** badge on the toolbar icon shows it's still running. Stop it with Chrome's "Stop sharing" bar, or reopen the panel and press **Stop**. The recording then appears in the panel with a preview before uploading.
- Recordings you haven't uploaded are kept until you upload or remove them, even if you close the panel.
- **📷 Visible tab** screenshots what you can see of the current tab. **⬚ Select area** lets you drag a rectangle on the page (Esc or a plain click cancels). The first time, Chrome asks for permission to capture pages.
  The screenshot opens in an editor tab with **Draw**, **Text**, **Blur** (pixelates, so it's safe for passwords and emails) and **Crop**. It has 8 colors, 3 sizes and undo/redo (Ctrl+Z / Ctrl+Shift+Z). Shortcuts: P, T, B, C.
  An area selection opens already cropped; press undo to get the full screenshot back. **Attach** closes the editor and adds the image to the side panel.
- **Add files**, drag and drop, or paste a screenshot (Ctrl+V) anywhere in the panel.
- Recordings are WebM (VP9/Opus), which plays in ClickUp's viewer. The ClickUp limit is 1 GB per file.

If the task gets created but an upload fails, the task link stays on screen and the button becomes **Retry failed uploads**, so nothing is duplicated.

### Microphone permission

Chrome usually can't show the microphone prompt inside a side panel. When that happens, the panel shows **Grant microphone access**. Click it, allow the mic in the tab that opens, then record again. You only need to do this once.

## Project layout

```
manifest.json           MV3 manifest
background.js           opens the side panel; starts/stops the offscreen recorder, REC badge
sidepanel/              main UI (form, recording controls, uploads)
offscreen/              hidden document that owns the recording (survives the panel closing)
editor/                 screenshot annotation editor (draw, text, blur, crop)
options/                API token settings + revoke
permissions/            one-time microphone permission page
lib/clickup-api.js      ClickUp API v2 client (XHR for upload progress)
lib/recorder.js         getDisplayMedia + mic → MediaRecorder (WebM)
lib/attachments-db.js   IndexedDB store handing recordings/screenshots to the panel
lib/screenshot.js       visible-tab / area capture (injected area-selection overlay)
lib/storage.js          chrome.storage helpers
```

No build step: edit a file, then click the reload icon on `chrome://extensions`.

## Notes

- While recording, video is held in the offscreen document's memory. When you stop, it moves to IndexedDB until it's uploaded. That's fine for normal-length screen captures (roughly 5–15 MB per minute), but not for hour-long sessions.
- API used: `GET /team`, `/team/{id}/space`, `/space/{id}/folder`, `/space/{id}/list`, `/list/{id}`, `/task/{id}`; `POST /list/{id}/task`, `/task/{id}/attachment`.
