"use strict";

export const UNLOCK_DATABASE_NAME = "zzao-market-monitor-unlock";
export const UNLOCK_RECORD_VERSION = 1;
export const TAB_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const STORE_NAME = "keys";
const TRUSTED_RECORD_ID = "trusted-device-v1";
const SESSION_HANDLE_KEY = "zzao-monitor-unlock-session-v1";
const AUTO_RESTORE_SUPPRESSED_KEY = "zzao-monitor-unlock-suppressed-v1";
const SESSION_RECORD_PREFIX = "tab-session:";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("浏览器安全存储请求失败。"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("浏览器安全存储事务失败。"));
    transaction.onabort = () => reject(transaction.error || new Error("浏览器安全存储事务已中止。"));
  });
}

export function createIndexedDbUnlockAdapter(indexedDb = globalThis.indexedDB) {
  let databasePromise = null;

  function openDatabase() {
    if (!indexedDb || typeof indexedDb.open !== "function") {
      return Promise.reject(new Error("当前浏览器不支持安全设备存储。"));
    }
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDb.open(UNLOCK_DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        databasePromise = null;
        reject(request.error || new Error("无法打开浏览器安全存储。"));
      };
      request.onblocked = () => {
        databasePromise = null;
        reject(new Error("浏览器安全存储升级被其他页面阻止。"));
      };
    });
    return databasePromise;
  }

  async function read(id) {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    const result = await requestResult(transaction.objectStore(STORE_NAME).get(id));
    await done;
    return result || null;
  }

  async function write(record) {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).put(record);
    await done;
  }

  async function remove(id) {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).delete(id);
    await done;
  }

  async function readAll() {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    const result = await requestResult(transaction.objectStore(STORE_NAME).getAll());
    await done;
    return Array.isArray(result) ? result : [];
  }

  async function clear() {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).clear();
    await done;
  }

  return Object.freeze({ read, write, remove, readAll, clear });
}

export function isRestrictedUnlockKey(key) {
  if (!key || typeof key !== "object") return false;
  const usages = Array.from(key.usages || []);
  return (
    key.type === "secret" &&
    key.extractable === false &&
    key.algorithm?.name === "PBKDF2" &&
    usages.length === 1 &&
    usages[0] === "deriveKey"
  );
}

export function isValidUnlockRecord(record, { now, origin, expectedId = null, mode = null }) {
  const expectedTtl = record?.mode === "trusted"
    ? TRUSTED_DEVICE_TTL_MS
    : record?.mode === "session"
      ? TAB_SESSION_TTL_MS
      : null;
  const hasModeBoundId = record?.mode === "trusted"
    ? record?.id === TRUSTED_RECORD_ID
    : record?.mode === "session" && record?.id?.startsWith(SESSION_RECORD_PREFIX);
  return Boolean(
    record &&
      record.version === UNLOCK_RECORD_VERSION &&
      typeof record.id === "string" &&
      (!expectedId || record.id === expectedId) &&
      (record.mode === "session" || record.mode === "trusted") &&
      hasModeBoundId &&
      (!mode || record.mode === mode) &&
      record.origin === origin &&
      Number.isSafeInteger(record.createdAt) &&
      Number.isSafeInteger(record.expiresAt) &&
      Number.isSafeInteger(expectedTtl) &&
      record.expiresAt === record.createdAt + expectedTtl &&
      record.createdAt <= now &&
      record.expiresAt > now &&
      isRestrictedUnlockKey(record.key),
  );
}

function readSessionItem(sessionStore, key) {
  try {
    if (!sessionStore) return { ok: false, value: null };
    return { ok: true, value: sessionStore.getItem(key) || null };
  } catch {
    return { ok: false, value: null };
  }
}

function safeSessionGet(sessionStore, key) {
  return readSessionItem(sessionStore, key).value;
}

function safeSessionSet(sessionStore, key, value) {
  try {
    sessionStore?.setItem(key, value);
    return Boolean(sessionStore);
  } catch {
    return false;
  }
}

function safeSessionRemove(sessionStore, key) {
  try {
    if (!sessionStore) return false;
    sessionStore?.removeItem(key);
    return true;
  } catch {
    // Storage denial must not block manual password unlock.
    return false;
  }
}

function persistenceError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function defaultRandomId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function createUnlockPersistence({
  adapter = createIndexedDbUnlockAdapter(),
  sessionStore = globalThis.sessionStorage,
  now = () => Date.now(),
  randomId = defaultRandomId,
  origin = globalThis.location?.origin || "",
} = {}) {
  if (!origin) throw new Error("受信任设备存储必须绑定明确 origin。");

  async function removeInvalid(id) {
    try {
      await adapter.remove(id);
    } catch {
      // A failed cleanup must not turn an invalid record into an accepted one.
    }
  }

  async function purgeInvalidRecords() {
    const currentTime = now();
    const records = await adapter.readAll();
    await Promise.all(
      records.map(async (record) => {
        if (isValidUnlockRecord(record, { now: currentTime, origin })) return;
        if (typeof record?.id === "string") await removeInvalid(record.id);
      }),
    );
  }

  async function readValidated(id, mode) {
    const record = await adapter.read(id);
    if (isValidUnlockRecord(record, { now: now(), origin, expectedId: id, mode })) {
      return record;
    }
    if (record) await removeInvalid(id);
    return null;
  }

  async function restore() {
    const suppression = readSessionItem(sessionStore, AUTO_RESTORE_SUPPRESSED_KEY);
    // A browser that cannot prove the absence of a lock flag must never fall
    // through to a persistent trusted-device key.
    if (!suppression.ok || suppression.value === "1") return null;
    await purgeInvalidRecords();

    const sessionHandle = readSessionItem(sessionStore, SESSION_HANDLE_KEY);
    if (!sessionHandle.ok) return null;
    const sessionId = sessionHandle.value;
    if (sessionId?.startsWith(SESSION_RECORD_PREFIX)) {
      const record = await readValidated(sessionId, "session");
      if (record) return record;
      safeSessionRemove(sessionStore, SESSION_HANDLE_KEY);
    } else if (sessionId) {
      safeSessionRemove(sessionStore, SESSION_HANDLE_KEY);
    }

    return readValidated(TRUSTED_RECORD_ID, "trusted");
  }

  async function save(key, { trusted = false } = {}) {
    if (!isRestrictedUnlockKey(key)) {
      throw new Error("拒绝保存权限过宽或格式不符的解锁密钥。");
    }
    const createdAt = now();
    const mode = trusted ? "trusted" : "session";
    const id = trusted ? TRUSTED_RECORD_ID : `${SESSION_RECORD_PREFIX}${randomId()}`;
    const previousSessionId = safeSessionGet(sessionStore, SESSION_HANDLE_KEY);
    const expiresAt = createdAt + (trusted ? TRUSTED_DEVICE_TTL_MS : TAB_SESSION_TTL_MS);
    const record = {
      id,
      version: UNLOCK_RECORD_VERSION,
      mode,
      origin,
      createdAt,
      expiresAt,
      key,
    };

    if (!trusted) {
      // An unchecked box is an explicit opt-out from cross-browser-session trust.
      // Refuse to claim session-only persistence unless the trusted slot is gone.
      try {
        await adapter.remove(TRUSTED_RECORD_ID);
      } catch (error) {
        throw persistenceError(
          "TRUST_REVOCATION_FAILED",
          "无法确认已撤销旧的受信任设备记录；本次仅在内存中解锁。",
          error,
        );
      }
    }

    if (!trusted && !safeSessionSet(sessionStore, SESSION_HANDLE_KEY, id)) {
      throw new Error("当前浏览器禁止标签页安全存储。");
    }

    try {
      await adapter.write(record);
    } catch (error) {
      if (!trusted) safeSessionRemove(sessionStore, SESSION_HANDLE_KEY);
      throw error;
    }

    safeSessionRemove(sessionStore, AUTO_RESTORE_SUPPRESSED_KEY);
    if (trusted) {
      safeSessionRemove(sessionStore, SESSION_HANDLE_KEY);
      if (previousSessionId?.startsWith(SESSION_RECORD_PREFIX)) {
        await removeInvalid(previousSessionId);
      }
    } else {
      if (
        previousSessionId?.startsWith(SESSION_RECORD_PREFIX) &&
        previousSessionId !== id
      ) {
        await removeInvalid(previousSessionId);
      }
    }
    // Cleanup is maintenance after the new record has committed. A readAll
    // failure must not make callers believe that a successfully saved key was
    // only kept in memory.
    await purgeInvalidRecords().catch(() => {});
    return record;
  }

  async function discard(record) {
    // Callers need to know when deletion fails so they can suppress repeated
    // automatic attempts instead of silently retrying a broken record.
    if (typeof record?.id === "string") await adapter.remove(record.id);
    if (safeSessionGet(sessionStore, SESSION_HANDLE_KEY) === record?.id) {
      safeSessionRemove(sessionStore, SESSION_HANDLE_KEY);
    }
  }

  async function clearSession() {
    const sessionId = safeSessionGet(sessionStore, SESSION_HANDLE_KEY);
    safeSessionRemove(sessionStore, SESSION_HANDLE_KEY);
    if (sessionId?.startsWith(SESSION_RECORD_PREFIX)) await removeInvalid(sessionId);
  }

  function suppressAutoRestore() {
    return safeSessionSet(sessionStore, AUTO_RESTORE_SUPPRESSED_KEY, "1");
  }

  function allowAutoRestore() {
    return safeSessionRemove(sessionStore, AUTO_RESTORE_SUPPRESSED_KEY);
  }

  async function lockCurrentSession() {
    if (suppressAutoRestore()) {
      await clearSession();
      return Object.freeze({ persistence: "suppressed", trustedCleared: false });
    }

    // If this browser refuses the per-session suppression flag, the only way
    // to guarantee that a refresh cannot silently restore is to clear all keys.
    await adapter.clear();
    safeSessionRemove(sessionStore, SESSION_HANDLE_KEY);
    return Object.freeze({ persistence: "cleared", trustedCleared: true });
  }

  async function clearAll() {
    await adapter.clear();
    safeSessionRemove(sessionStore, SESSION_HANDLE_KEY);
    safeSessionRemove(sessionStore, AUTO_RESTORE_SUPPRESSED_KEY);
  }

  return Object.freeze({
    restore,
    save,
    discard,
    clearSession,
    lockCurrentSession,
    suppressAutoRestore,
    allowAutoRestore,
    clearAll,
    purgeInvalidRecords,
  });
}
