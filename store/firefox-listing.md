# Firefox Add-ons (AMO) listing — copy/paste sheet

Everything the addons.mozilla.org Developer Hub asks for. The Chrome sheet is `store/listing.md`;
this one only lists what differs. Build the upload with `node scripts/package.mjs`, which writes
`dist/<name>-<version>-firefox.zip` (and `dist/firefox/`, unpacked, for `about:debugging`).

The Firefox manifest is derived from `manifest.json` by `scripts/lib/firefox-manifest.mjs`; a unit
test (`tests/unit/firefox-manifest.test.mjs`) checks that every permission below matches it.

- **Add-on ID** (`browser_specific_settings.gecko.id`, frozen after the first upload): `clickup-video-upload@elbedeawi.github.io`
- **Minimum Firefox version:** 128.0 (ESR)
- **Privacy policy:** https://elbedeawi.github.io/Clickup-Chrome-Extension/privacy-policy.html
- **Homepage:** https://github.com/ElBedeawi/Clickup-Chrome-Extension
- **Support email:** wagih.elbedeawi+clickupvideo-chrome-ext@gmail.com
- **License:** MIT
- **Source code upload:** not needed. The add-on is plain ES modules with no build step or minification;
  the only generated file is `manifest.json`. Say so in the reviewer notes.

---

## Describe Add-on

**Name:** Video & Screenshot Uploader for ClickUp

**Summary** (max 250 chars):
Record your screen or capture and annotate screenshots, then attach them to a new or existing ClickUp task from the Firefox sidebar. Uses your own ClickUp API token; talks only to ClickUp.

**Description:** use the Chrome description from `store/listing.md` with these edits:
- "straight from Chrome's side panel" → "straight from the Firefox sidebar"
- "Record a clip of your entire screen, a window or a tab" → "Record a clip of your entire screen or a window"
  (Firefox's picker cannot share a single tab)
- "Keep recording with the side panel closed — a REC badge shows it's running" →
  "Keep the sidebar open while recording — a REC badge shows it's running, and Stop in the sidebar ends
  the clip. If the sidebar is closed, what was recorded so far is kept."

**Categories:** Productivity · Photos, Music & Videos
**Tags:** clickup, screen recording, screenshot, bug report, feedback

**Images:** reuse `store/images/screenshot-*.png` (the UI is identical) and `store/images/store-icon-128.png`
as the add-on icon. Note: the store screenshots are rendered in Chrome; the Firefox sidebar shows the same panel.

---

## Permissions (shown to the user at install)

| Permission | Why |
|---|---|
| `storage` | Stores the user's ClickUp API token and last-used Workspace/Space/Folder/List locally, plus the current recording state and small signals between the extension's own pages (`storage.session`). |
| `scripting` | "Screenshot → Select area": injects a temporary selection overlay into the current tab so the user can drag a rectangle; removed as soon as the selection is made. Only runs when the user picks "Select area". |
| `<all_urls>` (host permission) | The user can screenshot whatever page they are on: `tabs.captureVisibleTab` needs it for "Visible tab" / "Select area" and `scripting` needs it for the overlay. It is also what lets the sidebar read the active tab's URL (there is no `tabs` permission) to detect an open ClickUp task and prefill it. Pages are captured only on an explicit click; nothing is read or sent otherwise. |
| `https://api.clickup.com/*` (host permission) | All task creation, uploads, comments and workspace lookups go to the ClickUp API, authenticated with the user's own token. |

Not requested on Firefox (Chrome-only): `sidePanel`, `offscreen`. The sidebar is declared with `sidebar_action`
and the recorder runs inside it, so no offscreen document is needed.

---

## Data collection (`gecko.data_collection_permissions`)

Declared as **required**, matching the Chrome Web Store "data usage" answers and the privacy policy:

| Category | What it covers here |
|---|---|
| `authenticationInfo` | The user's ClickUp personal API token. Stored in the browser only and sent exclusively to `api.clickup.com` with each request. |
| `websiteContent` | Screen recordings and screenshots the user explicitly captures, uploaded to the user's own ClickUp task when they press Create/Upload. |

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
5. Record clip > Record Clip, pick a screen or window, then press Stop in the sidebar. (Keep the sidebar open while recording; Firefox's own "Stop Sharing" button does not reach sidebar pages.)
6. Click "Create task & upload".

Source: https://github.com/ElBedeawi/Clickup-Chrome-Extension — plain ES modules, no build step or
minification. manifest.json for Firefox is generated by scripts/lib/firefox-manifest.mjs from the
Chrome manifest; everything else is byte-identical.
```
