// Which browser flavour are we running in? Feature detection, evaluated lazily so this module
// can be imported in Node for tests and in pages where `chrome` is stubbed after import.
//
// Chrome (and other Chromium browsers): side panel UI, recorder in an offscreen document.
// Firefox: `sidebar_action` UI, no offscreen documents, so the sidebar page hosts the recorder.
// Opera exposes both namespaces; it behaves like Chrome.

const c = () => globalThis.chrome ?? {};

/** The background can create an offscreen document to host the recorder. */
export const hasOffscreen = () => !!c().offscreen;

/** The UI is a Firefox sidebar (no side panel API, but the sidebarAction one). */
export const isSidebar = () => !c().sidePanel && !!c().sidebarAction;

/** The share picker can preselect / share a single browser tab (Chrome's "Current tab"). */
export const canRecordTab = () => !isSidebar();

export const browserName = () => (isSidebar() ? 'Firefox' : 'Chrome');

/** How to re-enable site access for the extension, in the browser's own words. */
export const siteAccessHint = () =>
  isSidebar()
    ? 'Open about:addons → Extensions → Video & Screenshot Uploader for ClickUp → Permissions, allow “Access your data for all websites”, then try again.'
    : 'Open chrome://extensions → Video & Screenshot Uploader for ClickUp → Details → Site access, choose “On all sites”, then try again.';

/** Shown while recording where closing the UI would end the clip (Firefox); empty elsewhere. */
export const keepPanelOpenHint = () =>
  isSidebar()
    ? 'Keep this sidebar open while recording — closing it stops the clip. End it with Stop here; Firefox’s own “Stop Sharing” button doesn’t reach the sidebar.'
    : '';
