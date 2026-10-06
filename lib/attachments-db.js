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
const CHUNKS = 'chunks'; // the in-progress recording, one record per MediaRecorder chunk

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, makeRequest, storeName = STORE) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = makeRequest(tx.objectStore(storeName));
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

/**
 * Recorder sink that writes chunks to disk as they arrive instead of keeping the whole
 * video in memory. Blobs read back from IndexedDB are disk-backed, so assembling the
 * final File doesn't load it into RAM either.
 */
export function createChunkSink() {
  let writes = Promise.resolve();
  return {
    /** Drops leftovers from a recording that never finished (e.g. a crash). */
    reset: () => run('readwrite', (store) => store.clear(), CHUNKS),
    append(blob) {
      // Chain writes so chunks land in order and `assemble` can wait for all of them.
      writes = writes.then(() => run('readwrite', (store) => store.add(blob), CHUNKS));
      return writes;
    },
    async assemble(name, type) {
      await writes;
      const chunks = await run('readonly', (store) => store.getAll(), CHUNKS);
      const file = new File(chunks, name, { type });
      await run('readwrite', (store) => store.clear(), CHUNKS);
      return file;
    },
  };
}

/** Tells an open side panel to pick up new attachments. */
export function notifyAttachmentsChanged() {
  return chrome.storage.session.set({ attachmentsChangedAt: Date.now() });
}
