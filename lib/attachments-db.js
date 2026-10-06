// Pending attachments live in IndexedDB so other extension pages can hand files to the
// side panel — the offscreen recorder (recordings) and the screenshot editor (images) —
// even while the panel is closed. Every extension page shares the same origin, and so
// the same database.
//
// Record: { id, file, createdAt, draft?, crop? }
//   draft: true  → a screenshot still open in the editor; the side panel ignores it.
//   crop         → initial crop from "Select area", in CSS px: { x, y, w, h, viewportWidth }.

const DB_NAME = 'clickup-video-upload';
const STORE = 'recordings'; // historical name; holds any pending attachment

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, makeRequest) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = makeRequest(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/** @returns {Promise<number>} the new record id */
export function saveAttachment(file, extra = {}) {
  return run('readwrite', (store) => store.add({ ...extra, file, createdAt: Date.now() }));
}

export function getAttachment(id) {
  return run('readonly', (store) => store.get(id));
}

export async function updateAttachment(id, patch) {
  const record = await getAttachment(id);
  if (!record) throw new Error('Attachment no longer exists.');
  return run('readwrite', (store) => store.put({ ...record, ...patch }));
}

/** @returns {Promise<{ id: number, file: File, createdAt: number, draft?: boolean }[]>} */
export function listAttachments() {
  return run('readonly', (store) => store.getAll());
}

export function deleteAttachment(id) {
  return run('readwrite', (store) => store.delete(id));
}

/** Tells an open side panel to pick up new attachments. */
export function notifyAttachmentsChanged() {
  return chrome.storage.session.set({ attachmentsChangedAt: Date.now() });
}
