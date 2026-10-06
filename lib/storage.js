// chrome.storage.local helpers. The token is a secret, so it stays in `local`
// (never `sync`, which would replicate it to every signed-in Chrome).

const TOKEN_KEY = 'clickupToken';
const PREFS_KEY = 'prefs';

export async function getToken() {
  const { [TOKEN_KEY]: token } = await chrome.storage.local.get(TOKEN_KEY);
  return token || '';
}

export async function setToken(token) {
  await chrome.storage.local.set({ [TOKEN_KEY]: token.trim() });
}

/** Forgets the token and the last-used selection (which belongs to that account). */
export async function clearToken() {
  await chrome.storage.local.remove([TOKEN_KEY, PREFS_KEY]);
}

/** UI preferences, e.g. { last: { workspace, 'space:<teamId>', 'folder:<spaceId>', 'list:<spaceId>/<folderId>' } } */
export async function getPrefs() {
  const { [PREFS_KEY]: prefs } = await chrome.storage.local.get(PREFS_KEY);
  return prefs || {};
}

export async function setPrefs(patch) {
  const prefs = await getPrefs();
  await chrome.storage.local.set({ [PREFS_KEY]: { ...prefs, ...patch } });
}

export function onTokenChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && TOKEN_KEY in changes) callback(changes[TOKEN_KEY].newValue || '');
  });
}
