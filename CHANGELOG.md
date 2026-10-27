# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Background blur for the camera bubble**: pick **Medium blur** or **High blur** under the camera in the Record clip card, and the background behind you is blurred while you stay sharp. The card's bubble preview shows it live, and the **⤢** button next to the blur picker opens a large **Camera check** preview where you can switch between No blur, Medium and High to compare them. It runs entirely on your device using Google's open-source MediaPipe, packaged inside the extension (which is now about 14 MB). Nothing is sent anywhere: the library's built-in usage logging is blocked. Off by default. If blur can't start on a computer (it needs WebGL), the card says so, and a recording that asked for blur leaves the camera out rather than show your background.

### Changed

- The extension's security policy now only lets it connect to ClickUp (`*.clickup.com`), so the browser itself enforces that nothing goes anywhere else.

## [0.7.0] - 2026-10-23

### Added

- **Pause and resume** a recording from the recording strip. The paused stretch is left out of the clip, the timer stops, and the toolbar badge shows **II** while paused.
- **Mute the microphone** mid-recording from the recording strip, and unmute it again. The muted part of the clip is silent; system audio keeps recording.
- **3-second countdown** after you pick what to share, so you have time to switch to what you want to record. The strip counts down and the badge shows **…**; pressing Stop during the countdown cancels without saving anything. It's on by default: untick **3-second countdown** in the Record clip card to start recording right away.
- **Playback speed** (1×, 1.5×, 2×) in the full-size tab for a recording, to check a long clip before uploading it. The last speed you picked is remembered.

## [0.6.0] - 2026-10-19

### Changed

- **Clips**: no more 45 MB limit, and Save to Clips now shows real upload progress. The recording is uploaded straight from the panel; the ClickUp tab is only used to get a short-lived session token from your sign-in.

## [0.5.0] - 2026-10-19

### Added

- **Clips tab**: next to "New task" and "Existing task", a third destination saves recordings to your workspace's **Clips Hub**, where ClickUp transcribes them. In that tab the attachments area is video-only (no Screenshot tool, Attach takes videos, the Record clip card is open from the start), **Save to Clips** uploads what's pending, and an optional **Save to Clips when recording stops** toggle does it by itself when a recording you started in that tab ends. The tab you used last is remembered, so the panel reopens in Clips if that's your routine. Because the public ClickUp API cannot create Clips, this tab uses ClickUp's own web-app API: it needs you to be signed in to ClickUp in this browser (a background ClickUp tab is opened if none is), takes videos up to 45 MB, is undocumented and may stop working after a ClickUp update. If a save fails, the recording stays in the list to retry or attach to a task.

### Changed

- The Workspace, Space, Folder and List dropdowns now collapse into a single "Space › Folder › List" row once a list is chosen, so the title, description and attachments sit higher in the panel. Click **Change** to pick another location; the row opens by itself when there is no list yet.

## [0.4.0] - 2026-10-16

### Added

- **Open in a new tab** button on recordings and screenshots, for a full-size look (and a Download button) before uploading. The side panel can't go fullscreen, so the fullscreen control on a clip preview now opens that tab instead of doing nothing.
- Optional **camera bubble** in recordings: pick a camera in the Record clip card and you appear in the clip as a round, mirrored bubble. Drag it around a small preview of the recording (it snaps to the corners), choose S / M / L, and move or resize it while the recording runs. Like the microphone, a camera that can't be used doesn't stop the recording. Camera access is granted once in a helper tab, as the microphone is.

## [0.3.0] - 2026-10-14

### Added

- Rich-text task description, like ClickUp's editor: a toolbar for headings, bold, italic, strikethrough, inline code, links, bulleted, numbered and check lists, quotes, code blocks and dividers, plus clear formatting and undo/redo. Markdown shortcuts work as you type (`- `, `1. `, `[] `, `# `, `> `, ```` ``` ````, `---`, `**bold**`, `` `code` ``), and text pasted from web pages keeps its formatting. The description is sent to ClickUp as Markdown.

## [0.2.0] - 2026-10-09

### Added

- Firefox support (128+). `npm run package` now also builds `…-firefox.zip` for addons.mozilla.org and an unpacked `dist/firefox/`. Same UI in Firefox's sidebar, with these differences: no "Current tab" source and no system audio (Firefox's picker has neither), the sidebar must stay open while recording (if it is closed, the part recorded so far is kept and attached on the next open), recordings are stopped from the panel (Firefox's own "Stop Sharing" button does not reach sidebar pages), and Settings opens in a tab. The mic helper page now tells the panel directly when access was granted.
- Automated tests: unit tests (`npm test`) and headless smoke tests of the real UI in Chrome (`npm run test:smoke`) and Firefox (`npm run test:smoke:firefox`), run by GitHub Actions CI on every push and pull request.
- `AGENTS.md` (imported by `CLAUDE.md`) documenting the architecture, state, messages and platform constraints.

### Fixed

- Attachment toolbar labels were cut off on Linux and macOS (wider system fonts) at common side-panel widths. The toolbar now steps down to compact, then short labels ("Record"), then icons only.
- Error messages about protected pages and site access no longer assume Chrome.

## [0.1.0] - 2026-10-07

First public release.

### Added

- Side panel to create a ClickUp task (Workspace → Space → Folder → List) or attach to an existing one by URL, ID or by opening the task.
- Dropdowns remember your last choice under each workspace, space and folder.
- **Record clip:** record the entire screen, a window or a tab at 720p–4K or native resolution, with a choice of microphone, a live level meter and system audio. Recording continues with the side panel closed, and recordings are written to disk as they go.
- **Screenshots:** visible tab, selected area or entire screen, opened in an editor with draw, text, blur (pixelate) and crop, plus undo/redo.
- **More details** (collapsed): assignees, due date and time, tags and custom fields (text, number, currency, email, URL, phone, date, checkbox, dropdown, labels, rating).
- **Add a comment** when attaching to an existing task.
- Attach any file by picking, dragging or pasting it. Upload progress for each file, plus retry without duplicating the task.
- Automatic retry when ClickUp rate-limits requests (HTTP 429).
- Settings page with token test and revoke, and a Buy Me a Coffee link.

[Unreleased]: https://github.com/ElBedeawi/Clickup-Chrome-Extension/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/ElBedeawi/Clickup-Chrome-Extension/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/ElBedeawi/Clickup-Chrome-Extension/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/ElBedeawi/Clickup-Chrome-Extension/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ElBedeawi/Clickup-Chrome-Extension/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ElBedeawi/Clickup-Chrome-Extension/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ElBedeawi/Clickup-Chrome-Extension/compare/v0.1...v0.2.0
[0.1.0]: https://github.com/ElBedeawi/Clickup-Chrome-Extension/releases/tag/v0.1
