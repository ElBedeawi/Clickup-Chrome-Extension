# SPEC — "Before the release" (Brain² tab, YouTube)

GOAL:    a ClickUp user sees they can ask Brain² about a bug from the side panel, beside the bug, and wants the
         extension. Storyline A of STORYLINES.md.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps, voice only (Kokoro af_heart), no music, no SFX.
TIME:    39.6 s x 30 = 1188 frames. Scenes: `take` 0–32.6 (one continuous camera take), `endcard` 32.3–39.6.

LOOK:    ground #F4F2FD flat (no gradient, no grain); ink #1F1F29; muted #6B6B7B; accent #7B68EE only on one title
         word, the highlighter marks in the answer, and the end card URL.
         Titles: Bricolage Grotesque 700, 76 px, -0.02em, one line, centred over the window in ground shots.
         Browser chrome + toast: Segoe UI (local), 22–24 px. Product UI = real PNG captures of the panel at 3x
         (assets/ui, from `capture/capture.mjs` on the demo page) and the Acme checkout page (DemoShared.drawMockApp).
         The medium: a real browser window, radius 18 px, shadow 0 30px 80px rgba(31,31,41,.18) on the ground.
OBJECTS: browser window (tab strip #ECEBF1 50 px, toolbar white 56 px with back/forward/reload, URL pill
         "shop.acme.dev/checkout", our extension icon at the right); side panel 560 px wide (= 400 CSS px x 1.4);
         a chat toast "Lena Park · Product — Can we close the checkout bug before release?" 4:52 PM → 5:07 PM;
         macOS-style black arrow cursor 54 px with a white edge, screen space.
MOTION:  camera on #take-cam (x, y, scale, origin 0 0): moves 0.6 s power2.inOut; zoom-through 0.7 s power3.in.
         Arrivals expo.out 0.5–0.6 s; panel slide expo.out 0.55 s; title words blur 8→0 px, 0.16 s, 0.08 s apart;
         exits 0.2 s blur-out. UI state changes are hard swaps (that's how the UI behaves). Answer lines wipe
         left→right 0.22 s, 0.24 s apart. Cursor moves power2.inOut 0.35–0.5 s, press = scale 0.88 for 0.1 s.
SHOTS (camera states: hook s1.8 @(1150,775); tabs s1.3 @(0,0); full s1; ground s0.72 window at (269,242);
       panel s1.75 cx1371 cy500 | cy666):
  0.0–4.3   hook: bug punch-in, cursor on the overlapping Pay button, toast slides in 0.5. VO1 0.3.
  4.3–8.9   tension: pull to full; tabs pile up (5.2, 6.3, 6.9, 7.6, 8.0), skeleton pages, a comment thread
            scrolls; toast time flips to 5:07 PM at 8.3. VO2 4.8.
  8.9–12.4  reveal: extra tabs fold away; cursor clicks the extension icon 9.9; panel slides in, page narrows;
            pull back to ground, title "Ask Brain² beside the bug". VO3 9.4.
  12.4–16.7 proof: push to panel; + (13.6), type "pay", pick the task (14.55), type the question, Send 16.6. VO4 13.0.
  16.7–23.2 answer: "Reading the task", then the answer streams line by line 17.4–19.6, the composer pushed
            down; highlighter on Safari 19.85, Sara 20.7, cart page 21.5. VO5 16.8.
  23.2–24.6 payoff: pull back to full — the answer beside the bug.
  24.6–29.5 extras: push in; + menu (25.2) with Deep Research marked 26.2, Skills 27.4, model 28.3. VO6 24.6.
  29.5–32.4 claim: pull to ground, title "Your answer, beside the bug"; zoom through the extension icon 31.6. VO7 29.9.
  32.3–39.6 end card: the icon lands centre, name, "Free · Chrome and Firefox", URL, footnote. VO8 32.6.
BANNED:  dark void; glow/particles/click rings; purple gradients; three cards; title over a dimmed screenshot;
         docked logo; titles drifting after landing; any drawn ClickUp UI (only the extension's real panel);
         claiming the task is "detected" on a non-ClickUp page; claiming ClickUp affiliation.
QA:      0.2 (thumbnail: bug + cursor), 6.9 (tabs pile), 10.6 (panel in), 11.6 (title), 14.4 (search result),
         16.0 (typing), 18.4 (mid-stream), 21.8 (highlights), 24.0 (payoff), 26.4, 27.6, 28.6 (menus),
         30.8 (claim), 32.2 (zoom seam), 36.0 and 39.5 (end card).
