# Contributing

Thanks for helping improve **Video & Screenshot Uploader for ClickUp**! Bug reports, ideas and pull requests are all welcome.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug:** [open an issue](https://github.com/ElBedeawi/Clickup-Chrome-Extension/issues/new/choose) with steps to reproduce, your Chrome version and what you expected.
- **Suggest a feature:** open a feature request and describe the problem it solves. Check existing issues first.
- **Send a pull request:** for anything bigger than a small fix, open an issue first so we can agree on the approach.
- **Security problems:** please **don't** open a public issue. See [SECURITY.md](SECURITY.md).

## Development setup

There's no build step and no dependencies to install. The extension is plain JavaScript (ES modules), HTML and CSS.

1. Fork and clone the repository.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select the project folder.
3. Click the extension icon, open ⚙ Settings and paste a ClickUp personal API token (ClickUp → Settings → Apps).
   Use a test workspace if you can.
4. After editing files, click the reload icon on the extension's card. Reopen the side panel to pick up changes.

You need Chrome 123 or later. Node.js 22+ is only needed for the helper scripts in `scripts/`.

See the [README](README.md#project-layout) for how the code is organised, and [AGENTS.md](AGENTS.md) for the architecture (messages, storage, platform constraints).

## Coding guidelines

- **Keep it dependency-free.** No frameworks, bundlers or packages in the extension itself.
- **No remote code.** Manifest V3 and the Chrome Web Store forbid loading scripts from other sites. Bundle any assets locally.
- **Privacy first.** The extension talks only to `api.clickup.com`. Don't add analytics, tracking or new network destinations. If a change affects what data is handled, update [docs/privacy-policy.html](docs/privacy-policy.html) in the same PR.
- **Ask for as few permissions as possible.** A new permission needs a strong reason and a justification in [store/listing.md](store/listing.md).
- **Match the surrounding code:** 2-space indentation, single quotes, semicolons, small focused modules, short comments that explain *why*.

## Testing your change

Run the automated tests (Node 22+, no install needed):

```
npm test             # unit tests: API client, storage, editor geometry, release consistency
npm run test:smoke   # headless Chrome: loads the real side panel, editor and settings with demo data
```

The smoke tests need Chrome or Edge (set `CHROME=/path/to/chrome` if it isn't found). CI runs both on every push and
pull request. Add a unit test in `tests/unit/` for new logic, or a scene in `tests/smoke/ui.test.mjs` for new UI.

Some things can't be automated (real ClickUp, Chrome's share picker, the microphone), so also check by hand:

- [ ] Create a new task with and without attachments. Check the result in ClickUp.
- [ ] Attach to an existing task by URL, by ID, and by opening the task (auto-detect).
- [ ] If you touched recording: record a clip, close the side panel mid-recording, then stop it from Chrome's "Stop sharing" bar.
- [ ] If you touched screenshots or the editor: try all three capture modes and the draw, text, blur and crop tools.
- [ ] If you touched the side panel UI: check it at a **narrow width (about 320 px)** as well as the default, in light and dark mode.
- [ ] The browser console (side panel: right-click → Inspect) shows no errors.

## Store images and packaging

- `node scripts/render-assets.mjs` regenerates `icons/` and `store/images/` from `store/src/` with headless Chrome or Edge. Re-run it when you change the UI that appears in the screenshots.
- `node scripts/package.mjs` builds the upload zip in `dist/`. Bump `version` in `manifest.json` for releases.

## Pull requests

1. Create a branch from `main` (e.g. `fix/upload-retry` or `feat/annotation-arrow`).
2. Keep each PR focused on one change. Fill in the PR template.
3. Write commit messages in the imperative mood ("Add arrow tool", not "Added arrow tool").
4. Add a line to [CHANGELOG.md](CHANGELOG.md) under **Unreleased** for user-visible changes.
5. Be ready for review feedback. Small follow-up commits are fine; they'll be squashed when merging.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
