// External links shown in the UI. Links left empty stay hidden, so nothing broken ships.

/** Your Buy Me a Coffee page, e.g. 'https://buymeacoffee.com/<username>'. */
export const BUY_ME_A_COFFEE_URL = '';

/** Fills in [data-link="coffee"] links (and reveals them plus any .coffee-sep / .coffee-box) when a URL is set. */
export function hydrateLinks(root = document) {
  if (!BUY_ME_A_COFFEE_URL) return;
  root.querySelectorAll('[data-link="coffee"]').forEach((a) => {
    a.href = BUY_ME_A_COFFEE_URL;
    a.hidden = false;
  });
  root.querySelectorAll('.coffee-sep, .coffee-box').forEach((el) => (el.hidden = false));
}
