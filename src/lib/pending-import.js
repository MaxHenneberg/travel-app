export const PENDING_IMPORT_DB = 'trailbook-share-target';
export const PENDING_IMPORT_STORE = 'pending';
export const PENDING_IMPORT_TTL_MS = 24 * 60 * 60 * 1000;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Pending import database request failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Pending import transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Pending import transaction failed.'));
  });
}

async function openDatabase(indexedDBRef = globalThis.indexedDB) {
  if (!indexedDBRef?.open) throw new Error('IndexedDB is unavailable.');
  const request = indexedDBRef.open(PENDING_IMPORT_DB, 2);
  request.onupgradeneeded = () => {
    const database = request.result;
    const store = database.objectStoreNames.contains(PENDING_IMPORT_STORE)
      ? request.transaction.objectStore(PENDING_IMPORT_STORE)
      : database.createObjectStore(PENDING_IMPORT_STORE, { keyPath: 'id' });
    if (!store.indexNames.contains('deliveryKey')) store.createIndex('deliveryKey', 'deliveryKey', { unique: true });
    if (!store.indexNames.contains('createdAt')) store.createIndex('createdAt', 'createdAt');
  };
  return requestResult(request);
}

async function purgeExpiredInTransaction(store, now, ttlMs) {
  const records = await requestResult(store.getAll());
  for (const record of records) {
    if (!Number.isFinite(record.createdAt) || now - record.createdAt > ttlMs) store.delete(record.id);
  }
}

export async function createDeliveryKey(bytes) {
  const buffer = bytes instanceof ArrayBuffer ? bytes : await bytes.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function putPendingImport(file, options = {}) {
  const {
    indexedDB: indexedDBRef = globalThis.indexedDB,
    now = Date.now(),
    ttlMs = PENDING_IMPORT_TTL_MS,
    id = crypto.randomUUID(),
  } = options;
  const bytes = file.bytes instanceof ArrayBuffer ? file.bytes : await file.arrayBuffer();
  const deliveryKey = file.deliveryKey ?? await createDeliveryKey(bytes);
  const database = await openDatabase(indexedDBRef);
  try {
    const transaction = database.transaction(PENDING_IMPORT_STORE, 'readwrite');
    const store = transaction.objectStore(PENDING_IMPORT_STORE);
    await purgeExpiredInTransaction(store, now, ttlMs);
    const duplicate = await requestResult(store.index('deliveryKey').get(deliveryKey));
    if (duplicate) {
      await transactionDone(transaction);
      return { id: duplicate.id, duplicate: true };
    }
    store.put({
      id,
      deliveryKey,
      name: String(file.name ?? ''),
      type: String(file.type ?? ''),
      size: bytes.byteLength,
      bytes,
      createdAt: now,
      state: 'pending',
      source: ['picker', 'android-view'].includes(file.source) ? file.source : 'share-target',
    });
    await transactionDone(transaction);
    return { id, duplicate: false };
  } finally {
    database.close();
  }
}

export async function claimPendingImport(id, claimant, options = {}) {
  const { indexedDB: indexedDBRef = globalThis.indexedDB, now = Date.now(), ttlMs = PENDING_IMPORT_TTL_MS } = options;
  const database = await openDatabase(indexedDBRef);
  try {
    const transaction = database.transaction(PENDING_IMPORT_STORE, 'readwrite');
    const store = transaction.objectStore(PENDING_IMPORT_STORE);
    await purgeExpiredInTransaction(store, now, ttlMs);
    const record = await requestResult(store.get(id));
    if (!record || (record.state === 'reviewing' && record.claimant !== claimant)) {
      await transactionDone(transaction);
      return null;
    }
    record.state = 'reviewing';
    record.claimant = claimant;
    record.claimedAt = now;
    store.put(record);
    await transactionDone(transaction);
    return record;
  } finally {
    database.close();
  }
}

export async function deletePendingImport(id, options = {}) {
  const database = await openDatabase(options.indexedDB ?? globalThis.indexedDB);
  try {
    const transaction = database.transaction(PENDING_IMPORT_STORE, 'readwrite');
    transaction.objectStore(PENDING_IMPORT_STORE).delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function purgeExpiredImports(options = {}) {
  const { indexedDB: indexedDBRef = globalThis.indexedDB, now = Date.now(), ttlMs = PENDING_IMPORT_TTL_MS } = options;
  const database = await openDatabase(indexedDBRef);
  try {
    const transaction = database.transaction(PENDING_IMPORT_STORE, 'readwrite');
    await purgeExpiredInTransaction(transaction.objectStore(PENDING_IMPORT_STORE), now, ttlMs);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function countPendingImports(options = {}) {
  const database = await openDatabase(options.indexedDB ?? globalThis.indexedDB);
  try {
    const transaction = database.transaction(PENDING_IMPORT_STORE, 'readonly');
    return requestResult(transaction.objectStore(PENDING_IMPORT_STORE).count());
  } finally {
    database.close();
  }
}
