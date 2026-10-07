## What and why

<!-- What does this change, and what problem does it solve? Link the issue: "Fixes #123". -->

## How I tested it

<!-- See the checklist in CONTRIBUTING.md. Mention Chrome version and anything you couldn't test. -->

## Checklist

- [ ] `npm test` and `npm run test:smoke` pass
- [ ] Tested by loading the extension unpacked, with a real ClickUp token
- [ ] Side panel UI checked at a narrow width (~320 px) and in dark mode, if the UI changed
- [ ] No new permissions, network destinations or remote code (or they're justified below and in `store/listing.md`)
- [ ] `docs/privacy-policy.html` updated if what data is handled changed
- [ ] `CHANGELOG.md` updated under **Unreleased** for user-visible changes
- [ ] Store images re-rendered (`node scripts/render-assets.mjs`) if the UI in them changed
