const DEFAULT_DB_NAME = 'travel-app';
const DEFAULT_STORE_NAME = 'trips';
const DEFAULT_LOCAL_KEY = 'travel-app:trips:v1';

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function tripId(value) {
  const id = value?.trip?.id ?? value?.id;
  if (typeof id !== 'string' || id.trim() === '') throw new TypeError('A stored trip needs a non-empty id or trip.id.');
  return id;
}

function tripRevision(value) {
  const candidate = value?.revision ?? value?.trip?.revision ?? 1;
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : null;
}

function storageKey(value) {
  const id = tripId(value);
  const revision = tripRevision(value);
  return revision === null ? id : `${id}@${revision}`;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

async function openDatabase(indexedDB, dbName, storeName) {
  const request = indexedDB.open(dbName, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: 'id' });
  };
  return requestResult(request);
}

function indexedDbBackend(db, storeName) {
  return {
    mode: 'indexeddb',
    async put(id, value) {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put({ id, value: clone(value), updatedAt: new Date().toISOString() });
      await transactionDone(tx);
    },
    async get(id) {
      const tx = db.transaction(storeName, 'readonly');
      const result = await requestResult(tx.objectStore(storeName).get(id));
      return result ? clone(result.value) : null;
    },
    async list() {
      const tx = db.transaction(storeName, 'readonly');
      const result = await requestResult(tx.objectStore(storeName).getAll());
      return result.sort((a, b) => a.id.localeCompare(b.id)).map((entry) => clone(entry.value));
    },
    async delete(id) {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(id);
      await transactionDone(tx);
    },
    async clear() {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      await transactionDone(tx);
    },
    async replaceTrip(id, key, value) {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const records = await requestResult(store.getAll());
      for (const record of records) {
        try { if (tripId(record.value) === id) store.delete(record.id); } catch { /* Ignore unrelated corrupt records. */ }
      }
      store.put({ id: key, value: clone(value), updatedAt: new Date().toISOString() });
      await transactionDone(tx);
    },
  };
}

function localBackend(storage, key) {
  const read = () => {
    const parsed = JSON.parse(storage.getItem(key) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  };
  const write = (records) => storage.setItem(key, JSON.stringify(records));
  // Probe both operations: privacy modes can expose localStorage but reject writes.
  const records = read();
  write(records);
  return {
    mode: 'localstorage',
    async put(id, value) { const all = read(); all[id] = clone(value); write(all); },
    async get(id) { const value = read()[id]; return value === undefined ? null : clone(value); },
    async list() { const all = read(); return Object.keys(all).sort().map((id) => clone(all[id])); },
    async delete(id) { const all = read(); delete all[id]; write(all); },
    async clear() { write({}); },
    async replaceTrip(id, key_, value) {
      const all = read();
      for (const [key, record] of Object.entries(all)) {
        try { if (tripId(record) === id) delete all[key]; } catch { /* Ignore unrelated corrupt records. */ }
      }
      all[key_] = clone(value);
      write(all);
    },
  };
}

function memoryBackend() {
  const records = new Map();
  return {
    mode: 'memory',
    async put(id, value) { records.set(id, clone(value)); },
    async get(id) { return records.has(id) ? clone(records.get(id)) : null; },
    async list() { return [...records.keys()].sort().map((id) => clone(records.get(id))); },
    async delete(id) { records.delete(id); },
    async clear() { records.clear(); },
    async replaceTrip(id, key, value) {
      for (const [recordKey, record] of records) {
        try { if (tripId(record) === id) records.delete(recordKey); } catch { /* Ignore unrelated corrupt records. */ }
      }
      records.set(key, clone(value));
    },
  };
}

/**
 * Creates an async multi-trip repository. IndexedDB is preferred, localStorage is
 * used when it cannot open, and an in-memory store is the final safe fallback.
 */
export function createTripStore(options = {}) {
  const { dbName = DEFAULT_DB_NAME, storeName = DEFAULT_STORE_NAME, localKey = DEFAULT_LOCAL_KEY } = options;
  let indexedDB;
  let localStorage;
  try {
    indexedDB = Object.hasOwn(options, 'indexedDB') ? options.indexedDB : globalThis.indexedDB;
  } catch {
    indexedDB = undefined;
  }
  try {
    localStorage = Object.hasOwn(options, 'localStorage') ? options.localStorage : globalThis.localStorage;
  } catch {
    localStorage = undefined;
  }
  const memory = memoryBackend();
  let backendPromise;

  const fallbackBackend = () => {
    try {
      return localStorage ? localBackend(localStorage, localKey) : memory;
    } catch {
      return memory;
    }
  };
  const resolveBackend = () => {
    if (!backendPromise) {
      backendPromise = (async () => {
        if (!indexedDB?.open) return fallbackBackend();
        try {
          return indexedDbBackend(await openDatabase(indexedDB, dbName, storeName), storeName);
        } catch {
          return fallbackBackend();
        }
      })();
    }
    return backendPromise;
  };
  const run = async (method, ...args) => {
    const backend = await resolveBackend();
    try {
      return await backend[method](...args);
    } catch {
      if (backend.mode === 'memory') throw new Error(`Trip store ${method} failed.`);
      backendPromise = Promise.resolve(backend.mode === 'localstorage' ? memory : fallbackBackend());
      return (await backendPromise)[method](...args);
    }
  };

  return {
    async saveTrip(value) { await run('put', storageKey(value), value); return clone(value); },
    async replaceTrip(id, value) {
      if (typeof id !== 'string' || !id) throw new TypeError('A trip id is required for replacement.');
      await run('replaceTrip', id, storageKey(value), value);
      return clone(value);
    },
    async getTrip(id, revision) {
      if (typeof id !== 'string' || !id) return null;
      if (revision !== undefined && revision !== null) {
        if (!Number.isSafeInteger(revision) || revision < 1) return null;
        return run('get', `${id}@${revision}`);
      }
      const direct = await run('get', id);
      if (direct) return direct;
      const revisions = (await run('list')).filter((value) => tripId(value) === id && tripRevision(value) !== null);
      revisions.sort((a, b) => tripRevision(b) - tripRevision(a));
      return revisions[0] ?? null;
    },
    async listTrips() { return run('list'); },
    async deleteTrip(id, revision) {
      if (typeof id !== 'string' || !id) return;
      if (revision !== undefined && revision !== null) {
        if (Number.isSafeInteger(revision) && revision > 0) await run('delete', `${id}@${revision}`);
        return;
      }
      await run('delete', id);
      const revisions = (await run('list')).filter((value) => tripId(value) === id && tripRevision(value) !== null);
      await Promise.all(revisions.map((value) => run('delete', storageKey(value))));
    },
    async clear() { await run('clear'); },
    async storageMode() { return (await resolveBackend()).mode; },
  };
}
