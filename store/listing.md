# Chrome Web Store listing — copy/paste sheet

Everything the Developer Dashboard asks for, in dashboard order. Images are in `store/images/`
(regenerate with `node scripts/render-assets.mjs`). Build the upload zip with `node scripts/package.mjs`.

The privacy policy is hosted on GitHub Pages from `docs/privacy-policy.html`:
https://clickup-uploader.macawshub.com/privacy-policy.html

---

## Store listing tab

**Name** (from manifest): Video & Screenshot Uploader for ClickUp

**Summary** (from manifest, max 132 chars):
Record your screen or capture and annotate screenshots, then attach them to a new or existing ClickUp task. By Wagih Elbedeawi.

**Category:** Productivity → Workflow & Planning
**Language:** English

**Description:**

```
Report bugs and share feedback without leaving the page. Record your screen, grab an annotated screenshot, and attach it to a ClickUp task — new or existing — or save the recording to your ClickUp Clips, straight from Chrome's side panel.

RECORD YOUR SCREEN
• Record a clip of your entire screen, a window or a tab — pick the resolution (720p to 4K) and microphone
• Add yourself to the clip as a camera bubble (optional): drag it anywhere, resize it, even while recording
• Blur the background behind you in the camera bubble (medium or high), processed on your device
• Pause and resume, mute the mic, and a 3-second countdown to get ready
• Keep recording with the side panel closed — a REC badge shows it's running
• Preview the recording before it's uploaded

CAPTURE & ANNOTATE SCREENSHOTS
• Visible tab, a selected area, or your entire screen
• Draw, add text, crop — and blur (pixelate) emails, names or passwords before sharing
• Undo/redo and keyboard shortcuts

CREATE OR UPDATE TASKS
• Pick Workspace → Space → Folder → List; your last choices are remembered
• Title, rich-text description (headings, bold, lists, checklists, links, code), status and priority
• Optional details when you need them: assignees, due date, tags and custom fields
• Or add to an existing task: paste a link, or open the task and it's detected automatically — with an optional comment
• Add any other files by picking, dragging or pasting them

SAVE TO CLIPS (OPTIONAL)
• A Clips tab saves recordings to your workspace's Clips Hub instead, where ClickUp transcribes them — by itself when the recording stops, if you like
• Needs you signed in to ClickUp in this browser; uses ClickUp's own web-app API, which is undocumented and may stop working after a ClickUp update

PRIVATE BY DESIGN
• Uses your own ClickUp API token, stored only in your browser
• Talks only to ClickUp — no developer servers, no analytics, no tracking
• Recordings and screenshots stay on your computer until you upload them

GETTING STARTED
1. Copy your personal API token from ClickUp → Settings → Apps
2. Click the extension icon, open Settings (⚙) and paste it
3. Record or capture, fill in the task, and press Create

Enjoying it? You can support development with a coffee: https://buymeacoffee.com/wagih.elbedeawi

Made by Wagih Elbedeawi. This extension is not affiliated with, endorsed by or sponsored by ClickUp. "ClickUp" is a trademark of its owner, used here only to describe compatibility.
```

**Graphic assets**
| Field | File |
|---|---|
| Store icon (128×128) | `store/images/store-icon-128.png` |
| Screenshot 1 | `store/images/screenshot-1-record.png` |
| Screenshot 2 | `store/images/screenshot-2-annotate.png` |
| Screenshot 3 | `store/images/screenshot-3-details.png` |
| Screenshot 4 | `store/images/screenshot-4-existing.png` |
| Screenshot 5 | `store/images/screenshot-5-clips.png` |
| Global promo video (YouTube URL) | https://youtu.be/IYCYp5thhZE (v2, Clips-first, 55 s; public on the Wagih El-Bedeawi channel; set in the 0.6.0 submission, 2026-10-19). Website hero and AMO description point to it too. Still to do once 0.6.0 is live: make v1 (https://youtu.be/GjaSTIQAYdM) Unlisted. Both rendered from `store/promo-video/`. |
| Small promo tile (440×280) | `store/images/promo-small-440x280.png` |
| Marquee promo tile (1400×560, optional) | `store/images/promo-marquee-1400x560.png` |

**Official URL / Homepage:** https://github.com/ElBedeawi/Clickup-Chrome-Extension
**Support URL:** mailto:wagih.elbedeawi+clickupvideo-chrome-ext@gmail.com

---

## Privacy practices tab

**Single purpose:**

```
Capture screen recordings and screenshots (with optional annotation) and attach them, with task details, to a new or existing task in the user's ClickUp workspace via the ClickUp API.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `sidePanel` | The extension's whole UI (task form, recording controls, attachments) lives in Chrome's side panel so it stays open while the user switches tabs and records. |
| `storage` | Stores the user's ClickUp API token and last-used Workspace/Space/Folder/List locally, and the current recording state so the side panel can show it after being reopened. |
| `offscreen` | Screen recording ("Record clip") runs in an offscreen document (reasons DISPLAY_MEDIA and USER_MEDIA) so it keeps going when the user closes the side panel. USER_MEDIA covers the microphone and the optional camera bubble drawn into the clip. Also used for the "Entire screen" screenshot. |
| `scripting` | For the "Screenshot → Select area" feature: injects a temporary selection overlay into the current tab so the user can drag a rectangle to capture; the overlay is removed as soon as the selection is made. It only runs when the user chooses "Select area". Also, when the user presses "Save to Clips" in the optional Clips tab, it runs a small packaged function in an open app.clickup.com tab that asks ClickUp for a short-lived session token (using the user's existing sign-in), so the recording can be saved to their Clips Hub, which the public API cannot do. Nothing else is read from that page. |
| Host permission `<all_urls>` | The user can take a screenshot of whatever page they are on, so the extension needs access to any site: chrome.tabs.captureVisibleTab requires it for "Screenshot → Visible tab" and "Select area", and chrome.scripting requires it for the area-selection overlay. Pages are only captured when the user explicitly chooses a screenshot option. It is also used to read the active tab's URL locally to detect when the user is viewing a ClickUp task, so it can be prefilled, and it covers ClickUp's own hosts (`app.clickup.com`, `id.app.clickup.com`, the workspace's `*.clickup.com` API host) for the optional Clips tab ("Save to Clips"). No page content is read or sent anywhere otherwise. |
| Host permission `https://api.clickup.com/*` | All task creation, attachment uploads, comments and workspace lookups go to the ClickUp API. |

**Remote code:** No, I am not using remote code. (All scripts are packaged; no eval or remotely hosted code. The
optional camera-bubble background blur runs Google's MediaPipe as packaged WebAssembly, `vendor/mediapipe/`, hence
`'wasm-unsafe-eval'` in the CSP; its model ships in the package too. The library's built-in usage logging is blocked:
the extension refuses those requests, and the CSP `connect-src` only allows `https://*.clickup.com`.)

**Data usage — what user data is collected** (check these):
- ☑ **Authentication information** — the user's ClickUp API token (stored locally; sent only to api.clickup.com), and, only when they use the Clips tab ("Save to Clips"), a short-lived ClickUp session token obtained from their existing sign-in (kept in memory; sent only to ClickUp's own hosts).
- ☑ **Website content** — screenshots/recordings of pages the user explicitly captures (a recording may include the user's own camera picture as a bubble, if they chose a camera), uploaded to the user's own ClickUp task on request.
- ☐ Personally identifiable information, health, financial, personal communications, location, web history, user activity — not collected.

**Certifications** (check all three):
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://clickup-uploader.macawshub.com/privacy-policy.html

---

## Distribution tab

- **Visibility:** Public
- **Regions:** All regions
- **Pricing:** Free

---

## Test instructions (for the reviewer)

Leave **Username** and **Password** empty: the reviewer uses their own free ClickUp account.
Paste this into **Additional instructions** (441 of 500 characters; since 0.8.0 it also walks through the camera
blur and pause, and points at the packaged MediaPipe that the CSP's `'wasm-unsafe-eval'` is for):

```
Use your own free ClickUp account.
1. Sign up at clickup.com, then get a token at app.clickup.com/settings/apps (Generate).
2. Open the side panel, click the gear, paste the token, Save.
3. Pick Workspace, Space and List; enter a title.
4. Screenshot > Visible tab: draw, then Attach.
5. Record clip: pick a camera and Medium blur (local, packaged MediaPipe), Record Clip, pick a screen, Pause, Resume, Stop.
6. Click "Create task & upload".
```

The "Remote code" answer above (Privacy practices tab) explains the packaged WebAssembly and the blocked logging;
there is no separate notes field for it.
