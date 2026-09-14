// Encrypted roster cache (P7/P8, AT-501/AT-512/AT-623).
//
// The cold-boot offline path (AT-623: reload with the network disabled)
// needs a roster to render before any server round trip can succeed. The
// service worker (sw.js) answers the navigation and asset requests; this
// module answers the data. Rows are AES-GCM encrypted before they touch
// IndexedDB — a plaintext roster at rest would violate the same rule that
// keeps the mutation queue ciphertext-only (AT-512) — with a non-extractable
// key generated on first use and stored alongside the ciphertext, so the
// cache survives a reload but never leaves the browser and is unreadable
// from a raw copy of the IndexedDB file.

const DB_NAME = 'gridvault-cache';
const DB_VERSION = 1;
const KEY_STORE = 'keys';
const ROSTER_STORE = 'roster';
const KEY_ID = 'roster-key';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(ROSTER_STORE)) db.createObjectStore(ROSTER_STORE, { keyPath: 'cache_key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

function withStore(storeName, mode, run) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let outcome;
        try {
          outcome = run(store);
        } catch (error) {
          db.close();
          reject(error);
          return;
        }
        tx.oncomplete = () => {
          db.close();
          resolve(outcome);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error('IndexedDB transaction failed'));
        };
      })
  );
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

async function getOrCreateKey() {
  const existing = await withStore(KEY_STORE, 'readonly', (store) => requestToPromise(store.get(KEY_ID))).catch(
    () => undefined
  );
  if (existing?.key) return existing.key;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await withStore(KEY_STORE, 'readwrite', (store) => requestToPromise(store.put({ id: KEY_ID, key })));
  return key;
}

/** Encrypts and stores the roster rows under `cacheKey` (role:ward). */
export async function cacheRoster(cacheKey, rows) {
  if (typeof crypto === 'undefined' || !crypto.subtle) return;
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(rows));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  await withStore(ROSTER_STORE, 'readwrite', (store) =>
    requestToPromise(store.put({ cache_key: cacheKey, iv, ciphertext, cached_at: Date.now() }))
  );
}

/** Returns the last cached roster for `cacheKey`, or null if none/undecryptable. */
export async function getCachedRoster(cacheKey) {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  try {
    const row = await withStore(ROSTER_STORE, 'readonly', (store) => requestToPromise(store.get(cacheKey)));
    if (!row) return null;
    const key = await getOrCreateKey();
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv }, key, row.ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  }
}

/** Purges every cached roster and the encryption key (logout, AT-627 hygiene). */
export async function clearRosterCache() {
  await withStore(ROSTER_STORE, 'readwrite', (store) => requestToPromise(store.clear())).catch(() => undefined);
  await withStore(KEY_STORE, 'readwrite', (store) => requestToPromise(store.clear())).catch(() => undefined);
}
