---
format: 1920x1080
duration: 48s
message: "File the bug with the video attached, or save the recording to Clips, without leaving the page"
arc: Feature-Benefit Cascade (hook → record → annotate → file to a task → NEW save to Clips → private → CTA)
audience: people who file bugs and feedback in ClickUp all day (QA, support, designers, product folks)
mode: autonomous
music: none
---

## Video direction

- **Palette system** (from `frame.md`): canvas `bg` #FFFFFF; ink `text` #1F1F29 for every headline; `text-muted` #6B6B7B for sub-lines and chrome; `primary` #7B68EE is the ONLY accent (underlines, chips, the Clips tab highlight, the CTA pill, the icon glow); `card-bg` / `border` tints frame the screenshot cards; the recorder's red #E5484D appears only as the REC dot / Record button that is already inside the screenshots. No gradients except the extension icon's own.
- **Type** by role: `h1` for the hook and section headlines, `h2` for side headlines beside a screenshot card, `h3` for sub-lines, `tag` for chips ("NEW", "Chrome", "Firefox"), `counter` for the URL pill. Bricolage Grotesque throughout, weights 600/700 only.
- **Surface treatment**: the five store screenshots are 1280×800 renders of the real side panel docked right of a mock checkout page. Mount each as a `card-tinted` floating window (1.5px tinted border, 14px radius, no shadow). When a beat is about the panel, push the camera in on the right 400px of the screenshot so the panel fills ~55% of the frame height; when a beat is about the editor (frame 3) show the full image. Never show browser chrome, cursors, or scrollbars beyond what the renders already contain.
- **Motion grammar + reveal model**: long-tail settles (`power3`), smooth over bouncy; `spring-pop-entrance` only in its smooth register. Every frame reveals on the spoken cue: at t=0 only what the VO is saying enters; each further line, chip or card arrives when the VO names it, with reveals spread across the back half; then a held read. Aliveness during a hold: at most `sine-wave-loop` low-amplitude jitter on one element; no breathing, no back-half pan or push. Camera moves are front-half only and purposeful (one push-in per screenshot frame, then locked).
- **Rhythm / held frames**: frames 1 and 6 are typographic and quick; frames 2–5 each end on a ~1s held read of the surface; frame 7 is the long hold (the last ~45% of its runtime is dead static on the lockup). Frame 5 opens on a near-still title card ("NEW · Save to Clips") as the breather before the Clips surface.
- **Captions**: off (the voiceover is the only audio and the words are already on screen); keep every element inside the top ~83% anyway.
- **Negative list**: no stock photos, no purple-blue "AI" gradients, no bokeh, no 3D hands, no fake cursors; no slideshow (front-load then freeze) and no screensaver (elements floating independently); no `repeat`/`yoyo`, no randomness; never claim ClickUp affiliation; never invent a feature the landing page doesn't state.

## Frame 1 — Hook

- scene: Bold type on the white canvas lands the promise beat by beat, ending on "without leaving the page"
- voiceover: "A bug report your team can actually reproduce. Recorded, marked up, and on the ClickUp task — without leaving the page."
- duration: 6.955s
- poster: 5s
- transition_in: cut
- status: animated
- src: compositions/frames/01-hook.html
- type: hook
- persuasion: Future pacing (the outcome the viewer wants, before any feature)
- beat: aspiration → relief
- blueprint: compose (kinetic-type shape: beats replace each other in place at a fixed center anchor)
- focal: none (typography only)
- roles: none
- asset_candidates:

narrativeRole: speak the viewer's outcome language first — a reproducible bug report — and land the message by the second cue.
keyMessage: the whole report, video included, lands on the task without you leaving the page.

Compose: the kinetic-type contract — a fixed center anchor, one beat on screen at a time, each replaced in place; three beats, smooth settles instead of springs (frame.md register), one accent underline on the payoff phrase.
Scene 1 (0.0–2.6s): white canvas; "A bug report your team can actually reproduce." arrives dead-center as a per-word staggered reveal (`kinetic-beat-slam`, smooth register) in `h1` ink, two lines, centered template ~60% width; nothing else on screen; camera locked.
Scene 2 (2.6–4.8s): on "Recorded, marked up, and on the ClickUp task" the line clears (prior text fades up and away) and three short beats replace each other in place by hard cut (`discrete-text-sequence`): "Recorded." → "Marked up." → "On the task." — each lands as the VO says it, `h1` ink, centered; a small `primary` dot pops once beside each beat (`spring-pop-entrance`, smooth).
Scene 3 (4.8–6.96s): on "without leaving the page" the final line "without leaving the page." fades in centered (`h1`), and a `primary` underline draws left→right beneath "leaving the page" (`css-marker-patterns`) exactly on the word "page"; holds dead still to the end.

## Frame 2 — Record from the side panel

- scene: The side panel's Record clip card, pushed in on the real screenshot, while the capture options are named one by one
- voiceover: "Record your screen, a window, or a tab, straight from the side panel — with your mic, system audio, even a camera bubble."
- duration: 7.083s
- poster: 5s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/02-record.html
- type: feature_showcase
- persuasion: Show-don't-tell proof (the real panel, real controls)
- beat: confidence
- blueprint: device-surface-showcase (Adapt — static-tour variant)
- focal: assets/screenshot-1-record.png
- roles: screenshot-1-record.png = cutout (the floating window; camera pushes in on its right 400px, the panel)
- asset_candidates: assets/screenshot-1-record.png — the side panel next to the checkout page with the Record clip card open (source, resolution, microphone, camera, bubble stage, Record Clip button)

narrativeRole: first evidence beat — the recorder lives in the panel, with every option the page promises.
keyMessage: screen, window or tab; mic, system audio, camera bubble; all from the panel.

Adapt: keep the static-tour signature (surface held, element-level motion, camera settles then locks); the screen "advance" becomes one push-in onto the Record clip card and a side headline whose sub-lines reveal on cue; no tap, no cursor.
Scene 1 (0.0–1.4s): on "Record your screen", the screenshot card slides in from the right and settles smoothly (long-tail ease, no overshoot) as a `card-tinted` floating window filling ~70% of the frame, asymmetric 60/40 with the window right; the camera begins one push-in toward the panel's Record clip card (`coordinate-target-zoom`) so the panel fills ~55% of frame height by 1.4s, then locks for the rest of the frame.
Scene 2 (1.4–3.2s): left of the window, the side headline "Record" (`h2`, ink) reveals; beneath it three chips "Screen", "Window", "Tab" (`tag-pill`) fade-scale in one per spoken word (smooth settle), each with a short `primary` underline sweep (`css-marker-patterns`) as its word is said; the panel's source row ("Entire screen") gets a `primary` keyword glow (`asr-keyword-glow`) on "screen".
Scene 3 (3.2–5.8s): on "straight from the side panel" a thin `primary` bracket draws around the panel column inside the window (`svg-path-draw`); then on "your mic", "system audio", "camera bubble" three sub-lines reveal under the chips, one per cue, each fading up into its slot: "Microphone + level meter", "System audio (Chrome)", "Camera bubble"; the panel's microphone row and camera row each get a one-shot keyword glow (`asr-keyword-glow`) as named.
Scene 4 (5.8–7.08s): held read — window, headline, chips and sub-lines dead still; the camera is locked.

## Frame 3 — Annotate before anyone sees it

- scene: The screenshot editor, full width, with the blur, the red circle and the label called out as the VO names the tools
- voiceover: "Or grab a screenshot — draw, add text, blur the private bits, crop — before anyone sees it."
- duration: 5.611s
- poster: 4.5s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/03-annotate.html
- type: feature_showcase
- persuasion: Show-don't-tell proof (the real editor with a real annotation)
- beat: control
- blueprint: device-surface-showcase (Adapt — floating-window variant without the title-card opener)
- focal: assets/screenshot-2-annotate.png
- roles: screenshot-2-annotate.png = cutout (full editor window; callouts land on its blurred email, red circle and label)
- asset_candidates: assets/screenshot-2-annotate.png — the editor tab: checkout page with the email blurred, a red circle around the Pay button, the label "Overlaps the order summary", toolbar Draw/Text/Blur/Crop

narrativeRole: second evidence beat — the screenshot path, with privacy (blur) as the emotional hook.
keyMessage: draw, text, blur, crop; the private bits never leave your machine unblurred.

Adapt: keep the floating-window signature (one push-in → re-frame arc on a held window); skip the title-card opener (the hook already did it); the "sidebar highlight" becomes four tool chips lighting up on cue.
Scene 1 (0.0–1.2s): on "Or grab a screenshot" the editor window pushes in from the right (push-slide continuation, then a smooth `spring-pop-entrance` settle) as a `card-tinted` floating window filling ~78% of the frame, centered-right; the headline "Annotate" (`h2`) fades in top-left.
Scene 2 (1.2–3.4s): four `tag-pill` chips "Draw", "Text", "Blur", "Crop" sit in a row under the headline, greyed; each lights to `primary` fill (`asr-keyword-glow`) exactly on its spoken word; on "draw" the camera pushes in slightly toward the red circle (`coordinate-target-zoom`) and locks; on "text" a thin `primary` bracket draws around the label (`svg-path-draw`); on "blur the private bits" a bracket draws around the blurred email and a small `primary` chip "email blurred" pops beside it (`spring-pop-entrance`, smooth).
Scene 3 (3.4–4.4s): on "crop" the chip lights and a dashed `primary` rectangle draws around the main region of the editor canvas (`svg-path-draw`), then fades to 40%.
Scene 4 (4.4–5.61s): on "before anyone sees it" a sub-line "Full resolution. Nothing leaves your machine until you upload." (`h3`, muted) reveals under the chips; held read, camera locked, no further motion.

## Frame 4 — File it to a task, new or existing

- scene: The panel's More details (assignees, due date, tags, custom fields), then a lateral swap to the Existing task tab detected from the open ClickUp tab
- voiceover: "Create the task right there — title, description, assignees, due date, custom fields — or add it to the task you already have open."
- duration: 7.936s
- poster: 6.5s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-task.html
- type: feature_showcase
- persuasion: Friction reduction (no tab switch, no copy-paste; the task is detected)
- beat: ease
- blueprint: device-surface-showcase (Adapt — stepwise-flow variant, two screen states, lateral slide with persistent chrome)
- focal: assets/screenshot-3-details.png
- roles: screenshot-3-details.png = cutout (first screen: More details filled in) · screenshot-4-existing.png = supporting (second screen: Existing task tab with the detected task and a comment)
- asset_candidates: assets/screenshot-3-details.png — the panel's More details section with two assignees, a due date, two tags and custom fields filled in; assets/screenshot-4-existing.png — the panel on the Existing task tab, task URL detected and checked, a comment written, a recording in progress

narrativeRole: the filing beat — the task fields the team expects, then the shortcut for an existing task.
keyMessage: everything the task needs, right there; or attach to the task that's already open.

Adapt: keep the stepwise-flow signature (successive screen states inside one held surface, lateral slide, persistent chrome, no cursor); two states instead of three; the "commit press" becomes the Existing task tab highlight.
Scene 1 (0.0–1.3s): on "Create the task right there" the window card arrives (push-slide continuation, smooth settle) and the camera pushes in on the panel column of screenshot-3 so More details fills ~60% of frame height (`coordinate-target-zoom`), then locks; headline "File it" (`h2`) fades in left; asymmetric 40/60 with the panel right.
Scene 2 (1.3–4.6s): as the VO lists them, five chips reveal in a vertical list left of the panel, one per cue, each fading up into its slot with a smooth settle: "Title", "Rich-text description", "Assignees", "Due date", "Custom fields"; on "assignees" the panel's assignee chips get a one-shot keyword glow (`asr-keyword-glow`), on "due date" the date field, on "custom fields" the custom-fields block.
Scene 3 (4.6–6.8s): on "or add it to the task you already have open" the panel screen slides laterally (`3d-page-scroll` translateX form inside the clipped window, chrome persists): screenshot-3's panel exits left, screenshot-4's panel enters from the right and settles with the tab row visible; the "Existing task" tab gets a `primary` keyword glow (`asr-keyword-glow`) and a thin `primary` outline fades in around the detected task URL field (a plain opacity tween on a bordered box); the chips list crossfades (a plain opacity swap) to two lines: "Detected from the open ClickUp tab", "Add a comment while you're at it".
Scene 4 (6.8–7.94s): held read — the Existing task panel, the two lines, the bracket; locked camera; no motion.

## Frame 5 — NEW: save it to ClickUp Clips

- scene: A near-still "NEW · Save to Clips" title card, then the panel's Clips tab with Save to Clips, as the VO says what you get
- voiceover: "New: not a bug? Save the recording straight to your ClickUp Clips — transcribed and shareable, no task needed."
- duration: 6.464s
- poster: 5.5s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/05-clips.html
- type: feature_showcase
- persuasion: Value stacking on the new capability (transcribed, shareable, no task)
- beat: curiosity → relief
- blueprint: titlecard-reveal (Adapt — Product_Intro prelude card, one card, blur-snap handoff onto a held product-surface window)
- focal: assets/screenshot-5-clips.png
- roles: screenshot-5-clips.png = cutout (the floating window; camera pushed in on the panel's Clips tab)
- asset_candidates: assets/screenshot-5-clips.png — the panel on its Clips tab: explainer, "Save to Clips when recording stops" toggle, Record clip card open, a pending recording, Save to Clips button

narrativeRole: the news beat — the 0.5.0 feature, set apart by the breather card and the NEW chip.
keyMessage: recordings can skip the task and land in your Clips Hub, transcribed and shareable.

Adapt: keep the prelude card's one-move-then-hold contract and the blur-snap handoff; one card instead of three; the handoff lands on a held screenshot window (element-level highlights only, camera locked).
Scene 1 (0.0–1.5s): white canvas; on "New" a `tag-pill` "NEW" (`primary` fill, white text) pops centered (`spring-pop-entrance`, smooth) and the title "Save to Clips" (`h1`, ink) fades in beneath it with a slight scale settle; holds still through "not a bug?".
Scene 2 (1.5–3.2s): on "Save the recording straight to your ClickUp Clips" the title card blurs away and the window snaps into focus (`depth-of-field-blur` handoff): the screenshot-5 card is already pushed in on the panel column (panel ~60% of frame height), asymmetric 60/40 window right; the "Clips" tab gets a `primary` keyword glow (`asr-keyword-glow`) and a thin `primary` bracket draws around the Save to Clips button at the bottom of the panel (`svg-path-draw`); the "NEW" chip shrinks (a plain scale + position tween) to a small chip top-left beside a `h2` headline "Clips".
Scene 3 (3.2–5.4s): under the headline three lines reveal one per cue, each fading up into its slot: "Transcribed by ClickUp" on "transcribed", "Share like any Clip" on "shareable", "No task needed" on "no task needed"; on the last one the "Save to Clips when recording stops" toggle row in the panel gets a one-shot glow (`asr-keyword-glow`).
Scene 4 (5.4–6.46s): held read; camera locked; dead still.

## Frame 6 — Private by design

- scene: Four short value lines build into a vertical list with a check drawing beside each, on the bare canvas
- voiceover: "Your own API token. Talks to ClickUp and nothing else. No servers, no tracking. Free and open source."
- duration: 7.104s
- poster: 5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/06-private.html
- type: benefit_highlight
- persuasion: Risk reversal (nothing to trust but ClickUp itself; nothing to pay)
- beat: trust
- blueprint: grid-card-assemble (Reproduce — Benefits vertical-list, BUILD sub-mode)
- focal: none (typography only)
- roles: none
- asset_candidates:

narrativeRole: the trust beat — remove the objection before the ask.
keyMessage: your token, ClickUp only, no servers or tracking, free and open source.

Scene 1 (0.0–1.6s): white canvas; headline "Private by design" (`h2`, ink) fades in upper-left of a centered column (~50% width); on "Your own API token" line 1 "Your own API token, stored in your browser" (`h3`) enters: a `primary` circle marker pops (`spring-pop-entrance`, smooth), a check draws inside it (`svg-path-draw`), the text wipes in left→right (clip-path reveal).
Scene 2 (1.6–5.6s): lines 2–4 arrive the same way, each exactly on its cue (at ~1.9s, ~3.6s, ~5.0s), co-resident and accumulating: "Talks to ClickUp and nothing else" / "No servers, no analytics, no tracking" / "Free and open source (MIT)"; each new line is the brightest, earlier lines stay fully lit (BUILD mode, no dimming).
Scene 3 (5.6–7.1s): held read of the four-line list; the last check gets one `primary` glow pulse (`ambient-glow-bloom`, single pass); otherwise still.

## Frame 7 — Get it for Chrome and Firefox

- scene: The extension icon drops in, the name builds word by word, then the store row and the URL pill; long static hold on the end card
- voiceover: "Video and Screenshot Uploader for ClickUp. Free, for Chrome and Firefox."
- duration: 7.5s
- poster: 6s
- transition_in: crossfade
- status: animated
- src: compositions/frames/07-cta.html
- type: cta
- persuasion: Friction reduction (free, two stores, one URL)
- beat: motivation
- blueprint: logo-assemble-lockup (Adapt — Brand_Outro parts-arrive variant, full end card)
- focal: assets/brand-icon.svg
- roles: brand-icon.svg = cutout (the mark that drops in and anchors the lockup) · store-icon-128.png = supporting (fallback raster of the same mark if the SVG misbehaves; not shown twice)
- asset_candidates: assets/brand-icon.svg — the extension icon as vector; assets/store-icon-128.png — the same icon as a 128px PNG

narrativeRole: the ask — name, availability, URL; held long enough to read and type.
keyMessage: free, in the Chrome Web Store and on Firefox Add-ons; clickup-uploader.macawshub.com.

Adapt: keep the parts-arrive signature (icon drops in, title arrives in parts, bottom row completes the end card, then a dead-static hold ≥45% of runtime); no confetti; store badges become two `tag-pill` chips (we don't redraw store logos).
Scene 1 (0.0–1.2s): white canvas; on "Video" the brand icon (brand-icon.svg, ~22% of frame height) drops in from above and settles dead-center-upper (`spring-pop-entrance`, smooth, y-offset) with a soft `primary` glow behind it (a single fade-in-and-out radial glow, one pass).
Scene 2 (1.2–3.2s): the name "Video & Screenshot Uploader" (`h1`, ink) and a second line "for ClickUp" (`h2`, muted) build word by word beneath the icon as the VO reads them (`waterfall-entry`, lateral cascade, smooth), centered template ~70% width; the icon slides up slightly to make room (a plain y tween).
Scene 3 (3.2–4.8s): on "Free" a `tag-pill` "Free · Open source" pops under the name; on "Chrome and Firefox" two chips "Chrome Web Store" and "Firefox Add-ons" pop side by side (`spring-pop-entrance`, staggered); then the URL pill "clickup-uploader.macawshub.com" (`counter` type, `primary` text on `accent-light`) wipes in left→right beneath them (clip-path reveal) and its text snaps to ink on the final beat (a timeline set).
Scene 4 (4.8–7.5s): dead-static hold on the complete end card to the last frame (this is the deliverable stillness; the voice ends at 4.84s and the card simply holds); the final frame fades to the canvas over the last 0.3s only.
