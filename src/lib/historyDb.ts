import type { HistoryRecord } from "./history";
import type { KnowledgeEntry } from "./knowledge";

/** Minimal IndexedDB store. Lives in the app's WebView data dir, never leaves the machine. */
const DB_NAME = "gsa-history";
const STORE = "records";
const KSTORE = "knowledge";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(KSTORE)) db.createObjectStore(KSTORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
  store: string = STORE,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const dbAll = () => tx("readonly", (s) => s.getAll() as IDBRequest<HistoryRecord[]>);
export const dbPut = (r: HistoryRecord) => tx("readwrite", (s) => s.put(r));
export const dbDelete = (id: string) => tx("readwrite", (s) => s.delete(id));
export const dbClear = () => tx("readwrite", (s) => s.clear());

export const kAll = () => tx("readonly", (s) => s.getAll() as IDBRequest<KnowledgeEntry[]>, KSTORE);
export const kPut = (e: KnowledgeEntry) => tx("readwrite", (s) => s.put(e), KSTORE);
export const kDelete = (id: string) => tx("readwrite", (s) => s.delete(id), KSTORE);
