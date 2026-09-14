// Offline mutation queue (P7 frontend half, AT-625).
//
// Durable IndexedDB store so queued mutations survive a page reload, a
// generator changeover and a browser restart. Only mutation envelopes are
// stored (ids, device sequence, type, captured_at); cached dossier snapshots
// are ciphertext (AT-512) and nothing touches localStorage/sessionStorage.

const DB_NAME = 'gridvault-offline';
const DB_VERSION = 1;
const QUEUE_STORE = 'mutation_queue';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'client_mutation_id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

function withStore(mode, run) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(QUEUE_STORE, mode);
        const store = tx.objectStore(QUEUE_STORE);
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
          resolve(outcome instanceof Promise ? outcome : Promise.resolve(outcome));
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

export async function enqueueMutation(mutation) {
  if (mutation === null || typeof mutation !== 'object' || typeof mutation.client_mutation_id !== 'string') {
    throw new Error('enqueueMutation requires a client_mutation_id');
  }
  await withStore('readwrite', (store) => requestToPromise(store.put({ ...mutation, attempts: 0 })));
}

export async function listQueuedMutations() {
  const rows = await withStore('readonly', (store) => requestToPromise(store.getAll()));
  return (rows ?? []).sort((a, b) => {
    if (a.device_id !== b.device_id) return a.device_id < b.device_id ? -1 : 1;
    return a.device_seq - b.device_seq;
  });
}

export async function removeQueuedMutation(clientMutationId) {
  await withStore('readwrite', (store) => requestToPromise(store.delete(clientMutationId)));
}

export async function clearQueuedMutations() {
  await withStore('readwrite', (store) => requestToPromise(store.clear()));
}
