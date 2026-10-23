# Roadmap

What we are thinking of building next, and why. This is a list of intentions, not a promise: items move
as users ask for things and as browser APIs change. Vote counts are from ClickUp's public feedback board
(feedback.clickup.com) as of October 2026 and are used as a rough measure of demand for a capability,
not as a commitment by ClickUp or by this project.

Want something that isn't here, or want to bump an item? Open an issue or a pull request (see
[CONTRIBUTING.md](CONTRIBUTING.md)). What ships is listed in [CHANGELOG.md](CHANGELOG.md).

## Already covered

Things people ask ClickUp for that this extension already does.

| Ask on ClickUp's board | Votes | What we do |
|---|---|---|
| [Chrome Extension: Ability to Record using Clip](https://feedback.clickup.com/browser-extension/p/chrome-extension-ability-to-record-using-clip) | 48 | Record from the side panel on any page and attach to a new or existing task |
| [Webcam in Clips](https://feedback.clickup.com/feature-requests/p/webcam-in-clips) | 321 | Camera bubble, movable and resizable while recording (0.4.0) |
| [Record computer audio with Clip as well as mic audio](https://feedback.clickup.com/feature-requests/p/record-computer-audio-with-clip-as-well-as-mic-audio) | 124 | "Share audio" in the picker mixes system or tab audio with the microphone (Chrome) |
| [Screenshot & Image Markup on Desktop App](https://feedback.clickup.com/feature-requests/p/screenshot-image-markup-on-desktop-app) | 169 | "Entire screen" screenshot captures any app, then draw, text, blur and crop |
| [Firefox, pretty please!](https://feedback.clickup.com/integrations/p/firefox-pretty-please) | 834 | Firefox 128+ add-on on addons.mozilla.org (0.2.0) |
| [Edge Browser Extension](https://feedback.clickup.com/browser-extension/p/edge-browser-extension) | 53 | Installs in Edge, Brave, Opera and Vivaldi from the Chrome Web Store |
| [Choose Microphone for Voice Clips](https://feedback.clickup.com/feature-requests/p/choose-microphone-for-voice-clips) | 10 | Microphone picker with a live level meter |
| [Pause video recording and resume](https://feedback.clickup.com/feature-requests/p/pause-video-recording-and-resume) | 29 | Pause/Resume in the recording strip; the paused part is left out of the clip (0.7.0) |

In the task tabs, recordings and screenshots are uploaded as **task attachments** through the ClickUp API: they
don't appear in the Clips library and get no Clip transcript. The **Clips tab** (0.5.0) saves a recording to
the Clips Hub instead, but through ClickUp's private web-app API because the public API has no way to create a
Clip (see "Investigating" below).

## Next

Small changes with clear demand. Roughly in the order we expect to do them.

- **Arrows, rectangles, ellipses and numbered steps in the screenshot editor.** The most common annotation
  tools after free drawing; speech bubbles were asked for in
  [Screenshot Annotations Speech Bubbles](https://feedback.clickup.com/feature-requests/p/screenshot-annotations-speech-bubbles).
  New op types in the editor's op list, replayed like the existing ones.
- **Edit any pending image, not just fresh screenshots.** Open the editor on a pasted, dropped or picked image
  before uploading. Covers most of
  [Drawing on uploaded Screenshot](https://feedback.clickup.com/feature-requests/p/drawing-on-uploaded-screenshot)
  (42 votes) for the "before it goes to ClickUp" case.
- **Keyboard shortcuts** to take a screenshot or start a recording without opening the panel first
  (`commands` in the manifest, no new permission). The one-keystroke workflow is a recurring theme in the
  screenshot threads.
- **Copy to clipboard and Download in the editor**, so a screenshot can go into a chat or a doc without a task.
- **Warn before ClickUp's 1 GB per-file limit** with the current size shown while recording.

## Later

Useful, but each needs real design or engineering time.

- **Full-page (scrolling) screenshot** of the current tab.
  [scrolling screenshot](https://feedback.clickup.com/feature-requests/p/scrolling-screenshot) (15 votes) and comments on the
  markup thread. Scroll-and-stitch from a content script; sticky headers and lazy-loaded content are the hard part.
- **Camera-only recording** (no screen), for a quick video message. Asked for by sign-language users in
  [Video messaging/screen recorder with video](https://feedback.clickup.com/integrations/p/video-messagingscreen-recorder-with-video-webcam).
  The compositor already draws the camera; this is a fourth source.
- **Blur the background in the camera bubble** (optional toggle next to the camera picker). First choice is the
  platform's own effect: where the camera track reports a `backgroundBlur` capability (Chrome with OS-level camera
  effects, e.g. Windows Studio Effects or macOS), `applyConstraints({ backgroundBlur: true })` on the track in
  `lib/recorder.js` costs nothing and needs no new code in the compositor. Elsewhere (and on Firefox) blurring
  needs person segmentation on every frame, i.e. a segmentation model shipped in the extension and run in the
  compositor before the bubble is drawn. That clashes with the no-dependencies rule and adds megabytes, so the
  open question is whether to offer the toggle only where the platform supports it.
- **Record a region of the screen** instead of the whole surface. Crop in the compositor after capture.
- **Cursor highlight and click ripple** in recordings
  ([Screen Recording - Mouse click animation](https://feedback.clickup.com/feature-requests/p/screen-recording-mouse-click-animation)).
  Only possible for the "Current tab" source, where a content script can report the pointer.
- **Upload to the task as soon as the recording stops** (optional), to the task already selected in the panel.
  The Clips tab already has this ("Save to Clips when recording stops"); this is the task-attachment half of the
  "background auto-upload" in
  [Clips Features missing](https://feedback.clickup.com/feature-requests/p/clips-features-missing).
- **Create the new task as a subtask** of the task that is open. From
  [Chrome Extension: Support Subtasks](https://feedback.clickup.com/integrations/p/chrome-extension-support-subtasks).
- **Annotate an image that is already attached to a task**: download it through the API, edit, re-upload. The other
  half of the "Drawing on uploaded Screenshot" ask.
- **Trim the start and end of a recording.** Top reason people in
  [Why I still use Loom for now...](https://feedback.clickup.com/feature-requests/p/why-i-still-use-loom-for-now) (71 votes) stay on Loom,
  and the usual fix for the "I fumbled the first five seconds" problem. WebM can't be cut at an arbitrary point
  without re-muxing, and this project has no build step or dependencies, so the plan is: a trim bar in the viewer
  tab, then `WebCodecs` (`VideoDecoder` → `VideoEncoder`, Chrome 94+, Firefox 130+) to re-encode only the kept range,
  written out by a small hand-written WebM muxer in `lib/`. Fallback for browsers without `WebCodecs`: play the kept
  range through a canvas into a second `MediaRecorder`, which works everywhere but takes as long as the clip.
  The original stays in IndexedDB until the trimmed copy is saved, so a failed trim loses nothing.

## Investigating

Wanted, but no good approach yet.

- **Clips through a public API.** The Clips tab (0.5.0) saves a recording to the Clips Hub, as
  asked for in
  [Video Upload to Clips Library](https://feedback.clickup.com/feature-requests/p/video-upload-to-clips-library) and
  [Allow Manual Upload of Failed Clip Recordings](https://feedback.clickup.com/feature-requests/p/allow-manual-upload-of-failed-clip-recordings-to-clickup-clip-library).
  It works, but on ClickUp's private web-app API (a Clip is an attachment uploaded with `clip=true` and a
  session token minted from the browser's ClickUp cookies), so it can break on any ClickUp deploy and needs the
  user signed in to ClickUp. State of play (October 2026): **the public API has no Clips endpoint** and ClickUp's
  own UI has no "upload a video to Clips" either. Next step: a "Clips API" request on ClickUp's Public API board,
  pointing at this extension as a concrete consumer; if one ships, the private path is replaced.
- **Clip in a task comment.** ClickUp's "record in a comment" flow is the same upload with `parent=<task>`, a
  comment carrying a `link_preview` video block and a re-parent of the attachment to the comment. A natural
  follow-up to the workspace Clip, once that has proven stable.
- **ClickUp Brain from the side panel**: for example, drafting the new task's title and description from a
  recording or a screenshot, or asking Brain about the selected task without switching tabs. This fits the
  "data goes only to ClickUp" rule, because Brain is ClickUp's own AI. State of play (October 2026): **the public
  API has no Brain endpoint.**
  [Make ClickUp Brain available via API](https://feedback.clickup.com/public-api/p/make-clickup-brain-available-via-api)
  (10 votes) got an answer from ClickUp on 2026-09-29: they are "actively working on providing access to Brain via
  our MCP Server". Next step: wait for that, then check whether a browser extension can call ClickUp's MCP server
  directly (HTTPS + OAuth, no new dependency). Calling it would be a new ClickUp endpoint, so it would need a
  privacy policy and store listing update and would stay opt-in. Reverse-engineering Brain's private web-app API,
  the way the Clips tab does, is a fallback only: it would be even more fragile than Clips.
- **View tracking** from the Loom thread is a ClickUp-side feature and out of our hands.

## Not planned

- **Safari.** No sidebar API, and distribution needs an Xcode wrapper app and an Apple developer account.
- **System audio on Firefox.** Firefox's share picker has no audio option. Nothing to do on our side.
- **Recording while the Firefox sidebar is closed.** Firefox has no offscreen documents and unloads its event page
  within seconds; the partial recording is kept and attached on the next open, which is the best the platform allows.
- **Anything that sends data anywhere but ClickUp.** No analytics, no cloud processing, no AI summaries that need
  a third-party service. (The public API at `api.clickup.com` for everything; ClickUp's web-app hosts only for the
  optional Clips tab.)

## Distribution

- **Microsoft Edge Add-ons listing**, so Edge users on managed machines that block the Chrome Web Store can install it.
  Same zip as Chrome.
- Keep the Chrome Web Store and AMO listings' screenshots in step with the UI (`npm run render`).
