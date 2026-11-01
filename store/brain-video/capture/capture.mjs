import fs from 'node:fs';
import crypto from 'node:crypto';
// Re-captures the Brain² panel states on the demo page at 3x: `node store/brain-video/capture/capture.mjs` from the
// repo root writes capture/raw/; assets/ui/ holds the copies the film uses (names in compositions/take.html).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowser } from '../../../scripts/lib/headless.mjs';
const out = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), 'raw');
fs.mkdirSync(out, { recursive: true });
const W = 400, H = 900, DPR = 3;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rects = {};
await withBrowser(async ({ openPage }) => {
  const p = await openPage({ url: `/sidepanel/sidepanel.html?demo=brain&ask=0`, width: W, height: H });
  await p.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
  const ev = (js) => p.evaluate(js);
  const composerSel = `(document.getElementById('brain-input').closest('.brain-composer') || document.getElementById('brain-input').parentElement)`;
  const rect = async (name, sel) => { rects[name] = JSON.parse(await ev(`JSON.stringify((${sel}).getBoundingClientRect())`)); };
  const shot = async (name, clip) => {
    const params = { format: 'png' };
    if (clip) params.clip = { ...clip, scale: 1 };
    const b = Buffer.from((await p.send('Page.captureScreenshot', params)).data, 'base64');
    fs.writeFileSync(`${out}/${name}.png`, b); return b;
  };
  const setVal = (sel, v) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
  // No task detected: the active tab is shop.acme.dev, not a ClickUp task.
  await setVal('#task-ref', '');
  await ev(`document.activeElement && document.activeElement.blur()`);
  await sleep(700);
  console.log('suggest chip present?', await ev(`!!document.querySelector('.brain-chip.suggest')`));
  console.log('composer class', await ev(`${composerSel}.className`));
  await shot('01-empty');
  await rect('tabBrain', `document.getElementById('tab-brain')`);
  await rect('plus', `document.getElementById('brain-plus')`);
  await rect('composer', composerSel);
  await ev(`document.getElementById('brain-plus').click()`); await sleep(500);
  await shot('02-plus-0');
  await rect('plusInput', `document.querySelector('#brain-pop input')`);
  for (const [i, s] of ['p', 'pa', 'pay'].entries()) { await setVal('#brain-pop input', s); await sleep(i === 2 ? 1200 : 250); await shot(`02-plus-${i + 1}`); }
  await rect('taskRow', `document.querySelector('#brain-pop .brain-results .brain-row')`);
  await ev(`document.querySelector('#brain-pop .brain-results .brain-row').click()`); await sleep(500);
  await ev(`document.getElementById('brain-input').focus()`); await sleep(200);
  await shot('03-chip');
  await rect('composer2', composerSel);
  await rect('send', `document.getElementById('brain-send')`);
  const c = rects.composer2;
  const clip = { x: 0, y: Math.floor(c.y) - 8, width: W, height: Math.ceil(c.height) + 16 };
  rects.typeClip = clip;
  const q = "What's left before we can close this bug?";
  let n = 0;
  for (let i = 2; i <= q.length + 1; i += 2) { await setVal('#brain-input', q.slice(0, i)); await sleep(50); await shot(`04-type-${String(++n).padStart(2, '0')}`, clip); }
  await shot('04-typed');
  await ev(`document.getElementById('brain-send').click()`);
  const seen = new Set(); let k = 0;
  for (let t = 0; t < 30; t++) {
    const b = Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
    const h = crypto.createHash('md5').update(b).digest('hex');
    if (!seen.has(h)) { seen.add(h); fs.writeFileSync(`${out}/05-stream-${String(++k).padStart(2, '0')}.png`, b); }
    await sleep(100);
  }
  await ev(`document.activeElement && document.activeElement.blur()`); await sleep(300);
  await shot('06-answer');
  await rect('answerBody', `document.querySelector('.brain-msg.brain .brain-body')`);
  await rect('composer3', composerSel);
  await rect('skills', `document.getElementById('brain-skills')`);
  await rect('model', `document.getElementById('brain-model')`);
  await ev(`document.getElementById('brain-plus').click()`); await sleep(500); await shot('07-plus');
  console.log('switch', await ev(`(() => { const s = document.querySelector('#brain-pop input[type=checkbox], #brain-pop [role=switch]'); if (!s) return 'none'; s.click(); return s.outerHTML.slice(0, 120); })()`));
  await sleep(400); await shot('07-plus-deep');
  await rect('deep', `document.querySelector('#brain-pop input[type=checkbox], #brain-pop [role=switch]') || document.body`);
  await ev(`document.getElementById('brain-plus').click()`); await sleep(300);
  await ev(`document.getElementById('brain-skills').click()`); await sleep(700); await shot('08-skills');
  await ev(`document.getElementById('brain-skills').click()`); await sleep(300);
  await ev(`document.getElementById('brain-model').click()`); await sleep(700); await shot('09-model');
  console.log('errors', p.errors);
  const data = await ev(`new Promise(res => { const s = document.createElement('script'); s.src = '/store/src/demo-shared.js'; s.onload = () => { const c = document.createElement('canvas'); c.width = 2400; c.height = 1500; DemoShared.drawMockApp(c.getContext('2d'), 2400, 1500); res(c.toDataURL('image/png')); }; document.head.appendChild(s); })`);
  fs.writeFileSync(`${out}/page-checkout.png`, Buffer.from(data.split(',')[1], 'base64'));
});
fs.writeFileSync(`${out}/rects.json`, JSON.stringify(rects, null, 1));
console.log(JSON.stringify(rects));
