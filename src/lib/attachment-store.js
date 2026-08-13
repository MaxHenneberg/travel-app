export const DEFAULT_ATTACHMENT_LIMITS = Object.freeze({
  perFileBytes: 10 * 1024 * 1024,
  totalBytes: 50 * 1024 * 1024,
});

const DB_NAME = 'trailbook-local-attachments';
const STORE_NAME = 'attachments';
const ACTIVE_EXTENSIONS = new Set(['html', 'htm', 'svg', 'js', 'mjs', 'xhtml']);
const ACTIVE_TYPES = new Set(['text/html', 'image/svg+xml', 'application/javascript', 'text/javascript', 'application/xhtml+xml']);

export class AttachmentError extends Error {
  constructor(code, message) { super(message); this.name = 'AttachmentError'; this.code = code; }
}

export function sanitizeAttachmentName(value, fallback = 'attachment') {
  const leaf = String(value ?? '').replaceAll('\\', '/').split('/').pop();
  return leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180) || fallback;
}

export function attachmentKind(name, type = '') {
  const extension = sanitizeAttachmentName(name).split('.').pop().toLowerCase();
  const mime = String(type).toLowerCase().split(';')[0].trim();
  if (ACTIVE_EXTENSIONS.has(extension) || ACTIVE_TYPES.has(mime)) return 'unsupported';
  if (extension === 'pdf' && (mime === 'application/pdf' || !mime)) return 'pdf';
  if (extension === 'pkpass' && (mime === 'application/vnd.apple.pkpass' || mime === 'application/zip' || !mime)) return 'pass';
  return 'generic';
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

async function openDatabase(indexedDB, dbName) {
  const request = indexedDB.open(dbName, 1);
  request.onupgradeneeded = () => {
    const store = request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    store.createIndex('contextKey', 'contextKey', { unique: false });
    store.createIndex('tripId', 'tripId', { unique: false });
  };
  return requestResult(request);
}

function contextKey(scope) { return `${scope.tripId}:${scope.type}:${scope.ownerId}`; }
function generatedId() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function actionable(error, fallback) {
  if (error instanceof AttachmentError) return error;
  if (error?.name === 'QuotaExceededError') return new AttachmentError('quota', 'This browser does not have enough local storage. Remove an attachment or free device space, then try again.');
  return new AttachmentError('persistence', fallback);
}

export function createAttachmentStore(options = {}) {
  const indexedDB = Object.hasOwn(options, 'indexedDB') ? options.indexedDB : globalThis.indexedDB;
  const storageManager = Object.hasOwn(options, 'storageManager') ? options.storageManager : globalThis.navigator?.storage;
  const limits = { ...DEFAULT_ATTACHMENT_LIMITS, ...options.limits };
  let database;
  const db = async () => {
    if (!indexedDB?.open) throw new AttachmentError('persistence', 'Local attachments are unavailable because this browser does not provide durable IndexedDB storage.');
    try { database ??= openDatabase(indexedDB, options.dbName ?? DB_NAME); return await database; }
    catch (error) { database = undefined; throw actionable(error, 'The attachment database could not be opened. Check browser storage permissions and try again.'); }
  };
  const all = async () => {
    const database_ = await db();
    const tx = database_.transaction(STORE_NAME, 'readonly');
    return requestResult(tx.objectStore(STORE_NAME).getAll());
  };

  return {
    limits,
    async add(scope, file) {
      if (!scope?.tripId || !scope?.type || !scope?.ownerId) throw new AttachmentError('scope', 'Choose a valid trip, day, or stop before attaching a file.');
      const name = sanitizeAttachmentName(file?.name);
      const kind = attachmentKind(name, file?.type);
      if (kind === 'unsupported') throw new AttachmentError('unsupported', 'Active HTML, SVG, and script files are not supported. Choose a non-executable document instead.');
      if (!file?.size) throw new AttachmentError('unsupported', 'The selected file is empty and was not added.');
      if (file.size > limits.perFileBytes) throw new AttachmentError('size', `This file exceeds the ${Math.round(limits.perFileBytes / 1024 / 1024)} MB per-file limit.`);
      const records = await all();
      const used = records.reduce((sum, item) => sum + item.size, 0);
      if (used + file.size > limits.totalBytes) throw new AttachmentError('total', `Adding this file would exceed the ${Math.round(limits.totalBytes / 1024 / 1024)} MB attachment limit. Remove a local attachment first.`);
      const key = contextKey(scope);
      if (records.some((item) => item.contextKey === key && item.name === name && item.size === file.size)) {
        throw new AttachmentError('duplicate', 'This file is already attached here. Choose a different file or remove the existing copy first.');
      }
      if (storageManager?.estimate) {
        const estimate = await storageManager.estimate();
        if (Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage) && estimate.quota - estimate.usage < file.size) {
          throw new AttachmentError('quota', 'Available browser storage is too low for this file. Free device space or remove an attachment, then try again.');
        }
      }
      const record = {
        id: generatedId(), contextKey: key, tripId: scope.tripId, scopeType: scope.type, ownerId: scope.ownerId,
        name, label: name, type: String(file.type || 'application/octet-stream').slice(0, 120), kind, size: file.size,
        lastModified: file.lastModified || 0, addedAt: new Date().toISOString(), blob: file.slice(0, file.size, file.type || 'application/octet-stream'),
      };
      try {
        const database_ = await db();
        const tx = database_.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).add(record);
        await transactionDone(tx);
        return { ...record, blob: undefined };
      } catch (error) { throw actionable(error, 'The file could not be saved. Existing attachments were not changed; check storage permissions and try again.'); }
    },
    async list(scope) {
      try {
        const database_ = await db();
        const tx = database_.transaction(STORE_NAME, 'readonly');
        const records = await requestResult(tx.objectStore(STORE_NAME).index('contextKey').getAll(contextKey(scope)));
        return records.sort((a, b) => a.addedAt.localeCompare(b.addedAt)).map(({ blob, ...metadata }) => metadata);
      } catch (error) { throw actionable(error, 'Local attachments could not be read. Reload the app and check browser storage permissions.'); }
    },
    async get(id) {
      try {
        const database_ = await db();
        const tx = database_.transaction(STORE_NAME, 'readonly');
        return await requestResult(tx.objectStore(STORE_NAME).get(id)) ?? null;
      } catch (error) { throw actionable(error, 'The attachment could not be opened. Reload the app and try again.'); }
    },
    async rename(id, label) {
      const record = await this.get(id);
      if (!record) throw new AttachmentError('missing', 'This attachment no longer exists.');
      record.label = sanitizeAttachmentName(label, record.name);
      try {
        const database_ = await db(); const tx = database_.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record); await transactionDone(tx);
      } catch (error) { throw actionable(error, 'The display label could not be saved. The file was not changed.'); }
    },
    async remove(id) {
      try {
        const database_ = await db(); const tx = database_.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id); await transactionDone(tx);
      } catch (error) { throw actionable(error, 'The attachment could not be removed. It remains safely stored; try again.'); }
    },
    async removeTrip(tripId) {
      try {
        const database_ = await db(); const tx = database_.transaction(STORE_NAME, 'readwrite');
        const index = tx.objectStore(STORE_NAME).index('tripId');
        const keys = await requestResult(index.getAllKeys(tripId)); keys.forEach((key) => tx.objectStore(STORE_NAME).delete(key));
        await transactionDone(tx);
      } catch (error) { throw actionable(error, 'The trip attachments could not be cleared. The trip was kept so its documents are not orphaned.'); }
    },
    async usage() { const records = await all(); return { bytes: records.reduce((sum, item) => sum + item.size, 0), count: records.length, limitBytes: limits.totalBytes }; },
  };
}
