# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/ElBedeawi/Clickup-Chrome-Extension/compare/v0.1...HEAD
[0.1.0]: https://github.com/ElBedeawi/Clickup-Chrome-Extension/releases/tag/v0.1
