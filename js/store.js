// store.js — on-device storage (IndexedDB). Nothing is ever sent to a server.
//
// Object stores:
//   kv       settings, device key, hash-chain state, calibration, unfinished job
//   fields   {id, label, boundary:[[lat,lon]…], areaM2, centroid, method, createdAt}
//   jobs     {id, fieldId, implement, widthM, t0, t1, raw, windows, coverage, flags, …}
//   certs    certificates issued on THIS device
//   registry certificates scanned/verified by an officer on this device
//
// Judge mode (js/tour.js) switches to a SEPARATE database (TOUR_DB) with useDatabase(), so the
// tour's demo field, job, certificate, device key, hash chain and demo fleet never touch the
// user's real data. Exiting the tour deletes TOUR_DB; boot also deletes a leftover one.

export const REAL_DB = 'paraliproof';
export const TOUR_DB = 'paraliproof-tour';
const DB_VER = 1;
const STORES = ['kv', 'fields', 'jobs', 'certs', 'registry'];
let dbName = REAL_DB;
let dbp = null;

function open() {
  if (dbp) return dbp;
  const name = dbName;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'kv' ? 'k' : 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

/** Switch every later read/write to database `name` (REAL_DB or TOUR_DB). Closes the old connection. */
export async function useDatabase(name) {
  if (name !== REAL_DB && name !== TOUR_DB) throw new Error('unknown database ' + name);
  if (name === dbName && dbp) return;
  const old = dbp;
  dbName = name; dbp = null;
  try { (await old)?.close?.(); } catch {}
}
export const currentDatabase = () => dbName;

/** Close the connection and refuse every later read/write (until useDatabase()). Used when the tour
 *  exits just before the page reloads, so no in-flight tour work can land in any database. */
export async function lockDatabase() {
  const old = dbp;
  dbName = null;
  dbp = Promise.reject(new Error('database locked'));
  dbp.catch(() => {});
  try { (await old)?.close?.(); } catch {}
}

/** Delete the tour database (never the real one). Resolves even if another tab keeps it open. */
export async function deleteTourDatabase() {
  if (dbName === TOUR_DB) await useDatabase(REAL_DB);
  if (!globalThis.indexedDB?.deleteDatabase) return;
  await new Promise((resolve) => {
    const r = indexedDB.deleteDatabase(TOUR_DB);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let result;
    const r = fn(os);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  get: (store, id) => tx(store, 'readonly', (os) => os.get(id)),
  put: (store, obj) => tx(store, 'readwrite', (os) => os.put(obj)),
  del: (store, id) => tx(store, 'readwrite', (os) => os.delete(id)),
  all: (store) => tx(store, 'readonly', (os) => os.getAll()),
  clear: (store) => tx(store, 'readwrite', (os) => os.clear()),
};

export const kv = {
  get: async (k) => (await db.get('kv', k))?.v,
  set: (k, v) => db.put('kv', { k, v }),
  del: (k) => db.del('kv', k),
};

// Ask the browser not to evict our data under storage pressure.
export async function requestPersistence() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch {}
  return false;
}
