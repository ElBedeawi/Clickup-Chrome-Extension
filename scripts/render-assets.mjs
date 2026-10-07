// Renders the extension icons and Chrome Web Store images from store/src/ with headless Chrome.
//
//   node scripts/render-assets.mjs            # everything
//   node scripts/render-assets.mjs icons      # only jobs whose output path contains "icons"
//
// Set CHROME to a Chrome/Edge executable if it isn't found automatically.
// Demo pages run the real side panel / editor against sample data (see scripts/lib/headless.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, withBrowser } from './lib/headless.mjs';

const JOBS = [
  // Toolbar / extension-page icons: full bleed. Store icon: 96px artwork + 16px padding.
  { url: '/store/src/icon.html?size=16', w: 16, h: 16, out: 'icons/icon-16.png', transparent: true },
  { url: '/store/src/icon.html?size=32', w: 32, h: 32, out: 'icons/icon-32.png', transparent: true },
  { url: '/store/src/icon.html?size=48', w: 48, h: 48, out: 'icons/icon-48.png', transparent: true },
  { url: '/store/src/icon.html?size=128&pad=8', w: 128, h: 128, out: 'icons/icon-128.png', transparent: true },
  { url: '/store/src/icon.html?size=128&pad=16', w: 128, h: 128, out: 'store/images/store-icon-128.png', transparent: true },
  // Store listing images
  { url: '/store/src/screenshot.html?scene=new', w: 1280, h: 800, out: 'store/images/screenshot-1-record.png' },
  { url: '/store/src/editor-demo.html', w: 1280, h: 800, out: 'store/images/screenshot-2-annotate.png' },
  { url: '/store/src/screenshot.html?scene=details', w: 1280, h: 800, out: 'store/images/screenshot-3-details.png' },
  { url: '/store/src/screenshot.html?scene=existing', w: 1280, h: 800, out: 'store/images/screenshot-4-existing.png' },
  { url: '/store/src/promo.html?size=small', w: 440, h: 280, out: 'store/images/promo-small-440x280.png' },
  { url: '/store/src/promo.html?size=marquee', w: 1400, h: 560, out: 'store/images/promo-marquee-1400x560.png' },
];

const filter = process.argv[2];
const jobs = JOBS.filter((j) => !filter || j.out.includes(filter));
if (!jobs.length) {
  console.error(`No jobs match "${filter}".`);
  process.exit(1);
}

await withBrowser(async ({ openPage }) => {
  for (const job of jobs) {
    const page = await openPage({ url: job.url, width: job.w, height: job.h, transparent: job.transparent });
    if (!page.ready) console.warn(`  ${job.out}: timed out waiting for __ready, capturing anyway`);
    for (const e of page.errors) console.warn(`  ${job.out}: ${e}`);
    const out = path.join(ROOT, job.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, await page.screenshot());
    await page.close();
    console.log(`✓ ${job.out}`);
  }
});
