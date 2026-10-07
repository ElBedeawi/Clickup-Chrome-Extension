# Chrome Web Store listing — copy/paste sheet

Everything the Developer Dashboard asks for, in dashboard order. Images are in `store/images/`
(regenerate with `node scripts/render-assets.mjs`). Build the upload zip with `node scripts/package.mjs`.

**Before submitting:** set `BUY_ME_A_COFFEE_URL` in `lib/links.js` (and in the description below, or delete that line), replace `CONTACT_EMAIL` in `store/privacy-policy.html`, host that page, and put its URL in
*Privacy practices → Privacy policy URL*.

---

## Store listing tab

**Name** (from manifest): Video & Screenshot Uploader for ClickUp

**Summary** (from manifest, max 132 chars):
Record your screen or capture and annotate screenshots, then attach them to a new or existing ClickUp task. By Wagih Elbedeawi.

**Category:** Productivity → Workflow & Planning
**Language:** English

**Description:**

```
Report bugs and share feedback without leaving the page. Record your screen, grab an annotated screenshot, and attach it to a ClickUp task — new or existing — straight from Chrome's side panel.

RECORD YOUR SCREEN
• Record a clip of your entire screen, a window or a tab — pick the resolution (720p to 4K) and microphone
• Keep recording with the side panel closed — a REC badge shows it's running
• Preview the recording before it's uploaded

CAPTURE & ANNOTATE SCREENSHOTS
• Visible tab, a selected area, or your entire screen
• Draw, add text, crop — and blur (pixelate) emails, names or passwords before sharing
• Undo/redo and keyboard shortcuts

CREATE OR UPDATE TASKS
• Pick Workspace → Space → Folder → List; your last choices are remembered
• Title, Markdown description, status and priority
• Optional details when you need them: assignees, due date, tags and custom fields
• Or add to an existing task: paste a link, or open the task and it's detected automatically — with an optional comment
• Add any other files by picking, dragging or pasting them

PRIVATE BY DESIGN
• Uses your own ClickUp API token, stored only in your browser
• Talks only to ClickUp's API — no developer servers, no analytics, no tracking
• Recordings and screenshots stay on your computer until you upload them

GETTING STARTED
1. Copy your personal API token from ClickUp → Settings → Apps
2. Click the extension icon, open Settings (⚙) and paste it
3. Record or capture, fill in the task, and press Create

Enjoying it? You can support development with a coffee: BUY_ME_A_COFFEE_URL

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
| Small promo tile (440×280) | `store/images/promo-small-440x280.png` |
| Marquee promo tile (1400×560, optional) | `store/images/promo-marquee-1400x560.png` |

**Official URL / Homepage:** your website or GitHub page (optional)
**Support URL:** a support page or `mailto:` link (optional but recommended)

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
| `offscreen` | Screen recording ("Record clip") runs in an offscreen document (reasons DISPLAY_MEDIA and USER_MEDIA) so it keeps going when the user closes the side panel. Also used for the "Entire screen" screenshot. |
| `scripting` | For the "Area" screenshot, injects a temporary selection overlay into the current tab so the user can drag a rectangle; it is removed immediately. Only runs when the user clicks "Area". |
| Host permission `<all_urls>` | Needed by chrome.tabs.captureVisibleTab to screenshot whatever page the user is on when they click "Tab" or "Area", and by chrome.scripting for the area-selection overlay. Pages are only captured on explicit user click. Also used to read the current tab's URL to detect an open ClickUp task. |
| Host permission `https://api.clickup.com/*` | All task creation, attachment uploads, comments and workspace lookups go to the ClickUp API. |

**Remote code:** No, I am not using remote code. (All scripts are packaged; no eval or remotely hosted code.)

**Data usage — what user data is collected** (check these):
- ☑ **Authentication information** — the user's ClickUp API token (stored locally; sent only to api.clickup.com).
- ☑ **Website content** — screenshots/recordings of pages the user explicitly captures, uploaded to the user's own ClickUp task on request.
- ☐ Personally identifiable information, health, financial, personal communications, location, web history, user activity — not collected.

**Certifications** (check all three):
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** *(where you host `store/privacy-policy.html`)*

---

## Distribution tab

- **Visibility:** Public
- **Regions:** All regions
- **Pricing:** Free

---

## Test instructions (for the reviewer)

Reviewers need a ClickUp account to test. Create a free ClickUp workspace for review, generate a personal API
token there (ClickUp → Settings → Apps), and paste this into the **Test instructions** field (fill in the token):

```
1. Click the extension's toolbar icon to open the side panel, click ⚙ (Settings), paste this test API token and press Save:
   <TEST TOKEN FOR A REVIEW-ONLY CLICKUP WORKSPACE>
2. Back in the side panel, Workspace/Space/List are preselected. Enter a title.
3. Click "Tab" (screenshot) — an editor tab opens; draw or blur something, then "Attach".
4. Click "Record screen", pick a tab, wait a few seconds, then "Stop".
5. Click "Create task & upload". The success card links to the created task.
Optional: "More details" for assignees/due date/tags/custom fields; the "Existing task" tab to attach to a task by link.
```

Revoke/regenerate that token after review.
