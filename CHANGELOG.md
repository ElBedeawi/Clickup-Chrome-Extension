# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Automated tests: unit tests (`npm test`) and headless-Chrome smoke tests of the real UI (`npm run test:smoke`), run by GitHub Actions CI on every push and pull request.
- `AGENTS.md` (imported by `CLAUDE.md`) documenting the architecture, state, messages and platform constraints.

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
