// Frame clock for lib/compositor.js. Lives in a worker because the compositor runs in Chrome's
// offscreen document, which is never rendered: requestAnimationFrame doesn't fire there and
// main-thread timers can be throttled like a background tab's. Worker timers aren't.
// Protocol: post { fps } to (re)start ticking, { fps: 0 } to stop; each tick is a `0` message.
// A plain file (not a blob: URL) because the extension CSP only allows scripts from 'self'.
let timer = 0;
self.onmessage = ({ data }) => {
  clearInterval(timer);
  timer = 0;
  const fps = Number(data?.fps) || 0;
  if (fps > 0) timer = setInterval(() => self.postMessage(0), 1000 / fps);
};
