// A few small things for the landing page and the privacy policy.

// 0. Which store badge to lead with. Firefox is the only browser that can't use the Chrome Web
//    Store build; everything Chromium-based (Chrome, Edge, Brave, Opera, Vivaldi) can.
{
  const ua = navigator.userAgent;
  const browser = /Firefox\//.test(ua) ? 'firefox' : /Chrome\/|Chromium\//.test(ua) ? 'chromium' : 'unknown';
  document.documentElement.dataset.browser = browser;
}

// 1. Website analytics: Cloudflare Web Analytics, cookieless, no personal data. The token comes
//    from dash.cloudflare.com → Web Analytics → the site for clickup-uploader.macawshub.com.
//    Leave it empty to load nothing at all. This runs on the website only; the extension itself
//    never includes analytics (see privacy-policy.html).
const CLOUDFLARE_ANALYTICS_TOKEN = '7b6aef1d18f842f992c13d8b4f8185b2';

// Only on the published site: local previews and the smoke-test server never report.
const PUBLISHED_HOSTS = ['clickup-uploader.macawshub.com', 'elbedeawi.github.io'];
if (CLOUDFLARE_ANALYTICS_TOKEN && PUBLISHED_HOSTS.includes(location.hostname)) {
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.dataset.cfBeacon = JSON.stringify({ token: CLOUDFLARE_ANALYTICS_TOKEN });
  document.head.appendChild(s);
}

// 1b. Google Analytics 4 (gtag.js). Sets cookies; disclosed on the landing page and in the privacy
//     policy's "This website" section. Leave the ID empty to load nothing.
const GOOGLE_ANALYTICS_ID = 'G-9T6H2X1C34';
if (GOOGLE_ANALYTICS_ID && PUBLISHED_HOSTS.includes(location.hostname)) {
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_ID}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', GOOGLE_ANALYTICS_ID);
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
