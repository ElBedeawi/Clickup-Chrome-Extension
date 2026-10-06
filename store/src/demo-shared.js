// Shared drawing for store images: a fictional "Acme" checkout page with a visible bug
// (the Pay button overlaps the order summary), plus helpers to turn it into files.
// Classic script — exposes window.DemoShared.
(() => {
  const BASE_W = 1600;
  const BASE_H = 1000;
  const font = (weight, px) => `${weight} ${px}px "Segoe UI", system-ui, -apple-system, sans-serif`;

  function roundRect(ctx, x, y, w, h, r, fill, stroke) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function field(ctx, label, x, y, w, value) {
    ctx.fillStyle = '#374151';
    ctx.font = font(600, 18);
    ctx.fillText(label, x, y - 14);
    roundRect(ctx, x, y, w, 56, 10, '#fff', '#d1d5db');
    ctx.fillStyle = '#111827';
    ctx.font = font(400, 21);
    ctx.fillText(value, x + 18, y + 36);
  }

  /** Draws the mock page scaled to W×H. Returns key rects in W×H pixels. */
  function drawMockApp(ctx, W, H) {
    const s = W / BASE_W;
    ctx.save();
    ctx.scale(s, H / BASE_H);

    ctx.fillStyle = '#f4f6fb';
    ctx.fillRect(0, 0, BASE_W, BASE_H);

    // Top navigation
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, BASE_W, 72);
    ctx.fillStyle = '#fff';
    ctx.font = font(800, 30);
    ctx.fillText('acme', 48, 47);
    ctx.fillStyle = '#9ca3af';
    ctx.font = font(500, 19);
    ['Shop', 'Deals', 'Orders', 'Help'].forEach((t, i) => ctx.fillText(t, 190 + i * 112, 44));
    ctx.fillStyle = '#374151';
    ctx.beginPath();
    ctx.arc(1530, 36, 19, 0, Math.PI * 2);
    ctx.fill();

    // Heading
    ctx.fillStyle = '#111827';
    ctx.font = font(700, 42);
    ctx.fillText('Checkout', 80, 152);
    ctx.fillStyle = '#6b7280';
    ctx.font = font(400, 20);
    ctx.fillText('Step 3 of 3 · Payment', 80, 188);

    // Payment card
    roundRect(ctx, 80, 220, 860, 720, 18, '#fff', '#e5e7eb');
    ctx.fillStyle = '#111827';
    ctx.font = font(700, 24);
    ctx.fillText('Payment details', 112, 268);
    field(ctx, 'Email', 112, 324, 796, 'sara.ahmed@acme.io');
    field(ctx, 'Card number', 112, 430, 796, '4242 4242 4242 4242');
    field(ctx, 'Expiry', 112, 536, 380, '08 / 28');
    field(ctx, 'CVC', 528, 536, 380, '•••');
    field(ctx, 'Name on card', 112, 642, 796, 'Sara Ahmed');
    roundRect(ctx, 112, 740, 24, 24, 6, '#4f46e5');
    ctx.fillStyle = '#374151';
    ctx.font = font(400, 19);
    ctx.fillText('Save card for next time', 150, 759);

    // Order summary
    roundRect(ctx, 1000, 220, 520, 520, 18, '#fff', '#e5e7eb');
    ctx.fillStyle = '#111827';
    ctx.font = font(700, 24);
    ctx.fillText('Order summary', 1032, 268);
    const rows = [['Wireless headphones', '$99.00'], ['Shipping', '$10.00'], ['Tax', '$20.00']];
    ctx.font = font(400, 20);
    rows.forEach(([a, b], i) => {
      ctx.fillStyle = '#4b5563';
      ctx.fillText(a, 1032, 330 + i * 52);
      ctx.fillText(b, 1400, 330 + i * 52);
    });
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(1032, 476, 456, 2);
    ctx.fillStyle = '#111827';
    ctx.font = font(700, 22);
    ctx.fillText('Total', 1032, 520);
    ctx.fillText('$129.00', 1392, 520);

    // The bug: Pay button slides over the summary card
    roundRect(ctx, 760, 640, 360, 72, 12, '#4f46e5');
    ctx.fillStyle = '#fff';
    ctx.font = font(700, 23);
    ctx.textAlign = 'center';
    ctx.fillText('Pay $129.00', 940, 684);
    ctx.textAlign = 'start';

    ctx.restore();
    const r = (x, y, w, h) => ({ x: x * s, y: (y * H) / BASE_H, w: w * s, h: (h * H) / BASE_H });
    return { email: r(112, 324, 796, 56), button: r(760, 640, 360, 72), summary: r(1000, 220, 520, 520) };
  }

  function canvasOf(W, H) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return c;
  }

  const toBlob = (canvas, type = 'image/png') => new Promise((resolve) => canvas.toBlob(resolve, type));

  /** Mock page as PNG; `annotated` adds the kind of markup the editor produces. */
  async function mockPng(W = BASE_W, H = BASE_H, { annotated = false } = {}) {
    const c = canvasOf(W, H);
    const ctx = c.getContext('2d');
    const rects = drawMockApp(ctx, W, H);
    if (annotated) {
      const b = rects.button;
      ctx.strokeStyle = '#e5484d';
      ctx.lineWidth = W / 160;
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w * 0.68, b.h * 1.1, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#e5484d';
      ctx.font = font(700, W / 36);
      ctx.fillText('Overlaps the summary', b.x - W * 0.02, b.y + b.h * 2.6);
    }
    return { blob: await toBlob(c), rects };
  }

  /** A short WebM "screen recording": a cursor moves to the Pay button and clicks. */
  function mockVideo(W = 800, H = 500, ms = 1600) {
    return new Promise((resolve) => {
      const c = canvasOf(W, H);
      const ctx = c.getContext('2d');
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp8' });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      const start = performance.now();
      const frame = () => {
        const t = Math.min(1, (performance.now() - start) / ms);
        const { button } = drawMockApp(ctx, W, H);
        const tx = button.x + button.w * 0.6;
        const ty = button.y + button.h * 0.5;
        const x = 120 + (tx - 120) * t;
        const y = 120 + (ty - 120) * t;
        if (t > 0.85) {
          ctx.fillStyle = 'rgba(229,72,77,0.35)';
          ctx.beginPath();
          ctx.arc(x, y, 18, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 22);
        ctx.lineTo(x + 6, y + 16);
        ctx.lineTo(x + 15, y + 16);
        ctx.closePath();
        ctx.fill();
        if (t < 1) requestAnimationFrame(frame);
        else rec.stop();
      };
      rec.start();
      frame();
    });
  }

  window.DemoShared = { BASE_W, BASE_H, drawMockApp, mockPng, mockVideo };
})();
