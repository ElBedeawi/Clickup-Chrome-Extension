// Two small things for the landing page and the privacy policy.

// 1. Website analytics: Cloudflare Web Analytics, cookieless, no personal data. The token comes
//    from dash.cloudflare.com → Web Analytics → the site for clickup-uploader.macawshub.com.
//    Leave it empty to load nothing at all. This runs on the website only; the extension itself
//    never includes analytics (see privacy-policy.html).
const CLOUDFLARE_ANALYTICS_TOKEN = '';

if (CLOUDFLARE_ANALYTICS_TOKEN && location.hostname !== 'localhost' && location.protocol !== 'file:') {
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.dataset.cfBeacon = JSON.stringify({ token: CLOUDFLARE_ANALYTICS_TOKEN });
  document.head.appendChild(s);
}

// 2. The recording indicator in the hero counts up like the real one, unless motion is reduced.
const rec = document.querySelector('.rec time');
if (rec && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  let seconds = 0;
  const pad = (n) => String(n).padStart(2, '0');
  setInterval(() => {
    if (document.hidden) return;
    seconds = (seconds + 1) % 3600;
    rec.textContent = `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
  }, 1000);
}
