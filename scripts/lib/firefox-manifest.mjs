// Derives the Firefox manifest from manifest.json, which stays Chrome's so the repo loads
// unpacked in Chrome as-is. Pure (no fs, no chrome): used by scripts/package.mjs and the tests.
//
// What differs on Firefox:
//   - no side panel API → `sidebar_action`; background.js toggles it from the toolbar icon
//   - no offscreen documents → the sidebar hosts the recorder, so the permission goes away
//   - the background is an event page declared with `scripts`, not a service worker
//   - `options_page` is Chrome-only → `options_ui`
//   - addons.mozilla.org needs a fixed add-on id, a minimum version and a data-collection declaration

export const GECKO = {
  // Frozen: AMO ties the listing and every update to this id. Never change it.
  id: 'clickup-video-upload@elbedeawi.github.io',
  // ESR 128. Everything we rely on (storage.session, scripting, host permissions granted at install) is older.
  strict_min_version: '128.0',
  // Same answers as the Chrome Web Store listing: the API token and the user's own captures leave
  // the device, to api.clickup.com only. Required for new AMO submissions since November 2025.
  data_collection_permissions: {
    required: ['authenticationInfo', 'websiteContent'],
  },
};

const CHROME_ONLY_PERMISSIONS = new Set(['sidePanel', 'offscreen']);

/**
 * @param {Record<string, any>} manifest the Chrome manifest (not mutated)
 * @returns {Record<string, any>} the Firefox manifest
 */
export function toFirefoxManifest(manifest) {
  const { minimum_chrome_version, side_panel, options_page, background, permissions = [], ...rest } = manifest;
  return {
    ...rest,
    browser_specific_settings: { gecko: GECKO },
    permissions: permissions.filter((p) => !CHROME_ONLY_PERMISSIONS.has(p)),
    background: { scripts: [background.service_worker] },
    sidebar_action: {
      default_panel: side_panel.default_path,
      default_title: manifest.action.default_title,
      default_icon: manifest.action.default_icon,
      open_at_install: false, // like Chrome: nothing opens until the user clicks the toolbar icon
    },
    options_ui: { page: options_page, open_in_tab: true },
  };
}
