---
workflow: product-launch-video
flow: automation
storyboard: no
message: "File the bug with the video attached, or save the recording to Clips, without leaving the page"
destination: youtube
aspect: 1920x1080
language: en
audience: people who file bugs and feedback in ClickUp all day (QA, support, designers, product folks)
length: 35s
angle: feature-benefit cascade (record → annotate → attach → NEW save to Clips → private → free)
narration: yes
---

## Intent

The "Global promo video" for the Chrome Web Store listing (a YouTube link) and the landing page of the
free, open-source browser extension "Video & Screenshot Uploader for ClickUp" (by Wagih Elbedeawi). Sell it,
don't tour it: show that a bug report or piece of feedback can carry a screen recording or an annotated
screenshot and land on a ClickUp task, new or existing, without leaving the page; and that, new in 0.5.0,
a recording can skip the task and go straight to the workspace's ClickUp Clips. Confident, plain, warm;
no hype words. Private by design is a real selling point: your own token, talks only to ClickUp, no
servers, no analytics. Works in Chrome (and Edge, Brave, Opera, Vivaldi) and Firefox.

## Assets

- ../../../../../../../work/darts-solutions-inc/playground/clickup-video-upload-chrome-extension/store/images/screenshot-1-record.png — side panel next to a web page: new task with a recording and an annotated screenshot attached, Record clip card open (hero / record beat)
- ../../../../../../../work/darts-solutions-inc/playground/clickup-video-upload-chrome-extension/store/images/screenshot-2-annotate.png — the screenshot editor: blurred email, red circle, text label (annotate beat)
- ../../../../../../../work/darts-solutions-inc/playground/clickup-video-upload-chrome-extension/store/images/screenshot-3-details.png — "More details": assignees, due date, tags, custom fields (task details beat)
- ../../../../../../../work/darts-solutions-inc/playground/clickup-video-upload-chrome-extension/store/images/screenshot-4-existing.png — attaching to an existing task mid-recording, with a comment; three-tab row visible (existing task beat)
- ../../../../../../../work/darts-solutions-inc/playground/clickup-video-upload-chrome-extension/store/images/screenshot-5-clips.png — the Clips tab: explainer, auto-save toggle, Record clip card, pending recording, Save to Clips (Clips beat)
- ../../../../../../../work/darts-solutions-inc/playground/clickup-video-upload-chrome-extension/store/src/icon.svg — the extension icon (brand mark; end card)
- ../../../../../../../work/darts-solutions-inc/playground/clickup-video-upload-chrome-extension/store/images/store-icon-128.png — the same icon as PNG

## Customizations

- Voiceover: local Kokoro TTS (user allowed a voice only if local TTS works; it does). No music, no SFX: the user ruled out licensed audio (`music: none`).
- Brand accent #7b68ee (the extension's purple) and the landing page's blue #2d6ff2 for emphasis; the icon's gradient.
- End card: the extension name, "Free · Open source · Chrome and Firefox", and the URL clickup-uploader.macawshub.com.
- The five store screenshots are 1280×800 renders of the real side panel: use them as the product surface (show-them-as-they-are, cropped or pushed-in where a beat needs the panel alone).

## Notes

- Run shape: the user asked for the video while away ("let's create a global promo video for the stores"), so flow is automation with no storyboard round; decisions carry receipts in the delivery note.
- Must never claim ClickUp affiliation; "ClickUp" is used only to describe compatibility. The Clips tab uses ClickUp's own web app (sign-in needed); the video can say "save it to your ClickUp Clips" without the caveat, the store listing carries it.
- No talking head, no stock footage, no purple-blue "AI" gradients beyond the brand's own icon gradient.
- Keep every on-screen claim true to the product: Chrome and Firefox; records screen, window or tab; annotates (draw, text, blur, crop); new or existing task; comments; rich-text description; Clips Hub with transcript.
