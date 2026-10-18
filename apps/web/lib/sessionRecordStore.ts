import type { SessionRecord } from "@kairos/core";

const STORE_NAME = "sessionRecords";

function warn(error: unknown): void {
  console.warn("Session records could not be persisted or loaded", error);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open("kairos", 1);
    let abandoned = false;
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("startedAt", "startedAt");
    };
    request.onsuccess = () => {
      if (abandoned) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      abandoned = true;
      reject(new Error("IndexedDB upgrade is blocked"));
    };
  });
}

/** 永続化の失敗はタイマーに伝播させない。トランザクション完了まで待つ。 */
export async function addRecords(records: readonly SessionRecord[]): Promise<void> {
  if (records.length === 0) return;
  let database: IDBDatabase | undefined;
  try {
    database = await openDatabase();
    const connection = database;
    await new Promise<void>((resolve, reject) => {
      const transaction = connection.transaction(STORE_NAME, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
      const store = transaction.objectStore(STORE_NAME);
      for (const record of records) store.add(record);
    });
  } catch (error) {
    warn(error);
  } finally {
    database?.close();
  }
}

/** startedAt >= ms の記録を開始時刻順で返す。失敗時は空配列。 */
export async function loadRecordsSince(ms: number): Promise<SessionRecord[]> {
  let database: IDBDatabase | undefined;
  try {
    database = await openDatabase();
    const connection = database;
    return await new Promise<SessionRecord[]>((resolve, reject) => {
      const transaction = connection.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).index("startedAt").getAll(IDBKeyRange.lowerBound(ms));
      transaction.oncomplete = () => resolve(request.result as SessionRecord[]);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    warn(error);
    return [];
  } finally {
    database?.close();
  }
}
