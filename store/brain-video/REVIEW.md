# REVIEW — Brain² tab video, first cut (2026-11-01)

## Creative calls
- Storyline A "Before the release" (user's pick). Not built: B "Where did that answer come from?" (result first,
  traced back) and C "Inside the composer" (giant composer, dives into each control). Both in STORYLINES.md.
- One continuous camera take over a browser window, then a zoom through the extension's toolbar icon into the end card.
- **Fact fix vs. the pitch:** the task chip is only offered automatically when the active tab is a ClickUp task page
  (`detectTaskFromActiveTab` in sidepanel.js). On the Acme checkout page it is not, so the film adds the task with
  **+** → search "pay" → pick it. The voice says "Add the task with plus", never "it already knows".
- Everything inside the side panel is a real capture of the extension (demo data) at 3x; nothing in it is drawn.
  The browser frame, tabs, toast and grey "other pages" are generic and drawn; no ClickUp UI is drawn.
- The answer "streams" by wiping white covers off the final answer line by line while the real "Reading the task"
  composer slides down. The demo's own live text shows raw `**markdown**` mid-stream, so it was not used.
- Voice: Kokoro af_heart at 1.0 (same as the store promo); line 8 reuses the promo's CTA WAV. No music or SFX.

## Measured vs looked at
- `check`: passes. Snapshots looked at: 0.2, 2.2, 3.4, 6.9, 8.6, 10.6, 11.6, 14.4, 16.0, 18.4, 21.8, 24, 26.4,
  27.6, 28.6, 30.8, 32.0–32.5 (seam), 33.6, 39.35, plus the review and phone sheets.
- Sound: durations measured with ffprobe and pauses with silencedetect; nobody has heard the mix.
- Not checked: motion between snapshot points at full frame rate (watch the Studio preview).

## Weakest shot / with more time
- 4.3–8.9 the "old way": tab titles are small even at the 1.3x framing, and the grey stand-in pages are abstract.
  A real recording of someone hunting through ClickUp would be stronger (the user's own footage, not drawn UI).
- The camera goes panel → full → panel (23.2–25.0) for the payoff; it works but is the one back-and-forth.

## Warnings kept on purpose
- `text_below_floor`: browser chrome and panel text in the wide shots are context; every line meant to be read is
  shown in a 1.75x push-in.
- `dead_stretch` 19.9–23.1: the answer holds while the voice reads it (marked `data-hold` on the panel).
- `panel_out_of_canvas`: the camera pushes past the frame by design (`data-layout-allow-overflow` on the camera).
- `gsap_repeated_fromto_without_baseline` on title spans: from-values equal the CSS resting state (opacity 0).
- The model menu shows the demo's "GPT-6 Astra" row; the demo data mirrors ClickUp's model list format.
