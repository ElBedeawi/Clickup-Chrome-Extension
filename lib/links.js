// External links shown in the UI. Links left empty stay hidden, so nothing broken ships.

/** Your Buy Me a Coffee page, e.g. 'https://buymeacoffee.com/<username>'. */
export const BUY_ME_A_COFFEE_URL = 'https://buymeacoffee.com/wagih.elbedeawi';

/** The landing page (GitHub Pages from docs/). */
export const SITE_URL = 'https://clickup-uploader.macawshub.com/';
export const PRIVACY_URL = `${SITE_URL}privacy-policy.html`;
export const REPO_URL = 'https://github.com/ElBedeawi/Clickup-Chrome-Extension';

const LINKS = { coffee: BUY_ME_A_COFFEE_URL, site: SITE_URL, privacy: PRIVACY_URL, repo: REPO_URL };

/**
 * Fills in [data-link="coffee|site|privacy|repo"] links and reveals them; a coffee link also
 * reveals any .coffee-sep / .coffee-box. Links whose URL is empty stay hidden.
 */
export function hydrateLinks(root = document) {
  for (const [name, url] of Object.entries(LINKS)) {
    if (!url) continue;
    root.querySelectorAll(`[data-link="${name}"]`).forEach((a) => {
      a.href = url;
      a.hidden = false;
    });
  }
  if (BUY_ME_A_COFFEE_URL) root.querySelectorAll('.coffee-sep, .coffee-box').forEach((el) => (el.hidden = false));
}
