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

// 1b. Google Analytics 4 (gtag.js). It sets cookies, so it only loads after the visitor accepts the
//     consent banner; the choice is remembered, and "Cookie settings" in the footer reopens the banner.
//     Disclosed in the privacy policy's "This website" section. Leave the ID empty to load nothing.
const GOOGLE_ANALYTICS_ID = 'G-9T6H2X1C34';
const CONSENT_KEY = 'analytics-consent'; // 'granted' | 'denied'

function readConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

function saveConsent(value) {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Storage blocked: the banner simply shows again next visit.
  }
}

let analyticsLoaded = false;
function loadGoogleAnalytics() {
  // Only on the published site: local previews and the smoke-test server never report.
  if (analyticsLoaded || !PUBLISHED_HOSTS.includes(location.hostname)) return;
  analyticsLoaded = true;
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

/** Withdrawing consent: stop sending and delete the _ga cookies on this host and its parent domains. */
function removeGoogleAnalytics() {
  if (analyticsLoaded) window[`ga-disable-${GOOGLE_ANALYTICS_ID}`] = true;
  const parts = location.hostname.split('.');
  const domains = parts.map((_, i) => parts.slice(i).join('.')).filter((d) => d.includes('.'));
  for (const name of document.cookie.split(';').map((c) => c.split('=')[0].trim())) {
    if (!/^_ga/.test(name)) continue;
    for (const domain of ['', ...domains]) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=.${domain}` : ''}`;
    }
  }
}

function showConsentBanner() {
  if (document.querySelector('.consent')) return;
  const banner = document.createElement('section');
  banner.className = 'consent';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Cookie consent');
  banner.innerHTML = `
    <p>This site uses Google Analytics cookies to count visits. The extension itself never tracks you.
      <a href="privacy-policy.html#this-website">Details</a></p>
    <div class="consent-actions">
      <button type="button" class="btn consent-decline">Decline</button>
      <button type="button" class="btn primary consent-accept">Accept</button>
    </div>`;
  const choose = (value) => {
    saveConsent(value);
    banner.remove();
    if (value === 'granted') loadGoogleAnalytics();
    else removeGoogleAnalytics();
  };
  banner.querySelector('.consent-accept').addEventListener('click', () => choose('granted'));
  banner.querySelector('.consent-decline').addEventListener('click', () => choose('denied'));
  document.body.appendChild(banner);
}

if (GOOGLE_ANALYTICS_ID) {
  const consent = readConsent();
  if (consent === 'granted') loadGoogleAnalytics();
  else if (consent !== 'denied') showConsentBanner();
  for (const link of document.querySelectorAll('[data-cookie-settings]')) {
    link.hidden = false;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      showConsentBanner();
    });
  }
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

// 3. Click-to-play hero video: YouTube (privacy-enhanced youtube-nocookie.com) loads only after a click.
for (const link of document.querySelectorAll('.video-facade[data-youtube]')) {
  link.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let "open in new tab" work
    e.preventDefault();
    const frame = document.createElement('iframe');
    frame.src = `https://www.youtube-nocookie.com/embed/${link.dataset.youtube}?autoplay=1&rel=0`;
    frame.title = 'Video & Screenshot Uploader for ClickUp: the 55-second tour';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    link.closest('.hero-media')?.querySelector('.rec')?.remove();
    link.replaceWith(frame);
    frame.focus();
  });
}
