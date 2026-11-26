import {
  byId,
  payloadUrl,
  unlockPersistenceRecord,
  unlockPersistenceWarning
} from "./context.mjs";

// @app-block-start b041
export function b64bytes(value) {
  const normalized = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
// @app-block-end b041

// @app-block-start b042
export function bytesB64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
// @app-block-end b042

// @app-block-start b043
export async function importUnlockKey(password) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
}
// @app-block-end b043

// @app-block-start b044
export async function decryptEnvelope(envelope, passwordKey) {
  let salt;
  let iv;
  let ciphertext;
  try {
    if (envelope?.version !== 1 || envelope?.cipher !== "AES-256-GCM"
      || envelope?.kdf !== "PBKDF2-SHA-256" || !Number.isInteger(envelope.iterations)
      || envelope.iterations < 100_000 || envelope.iterations > 2_000_000) throw new Error("Invalid envelope metadata");
    salt = b64bytes(envelope.salt);
    iv = b64bytes(envelope.iv);
    ciphertext = b64bytes(envelope.ciphertext);
    if (salt.byteLength < 16 || iv.byteLength !== 12 || ciphertext.byteLength < 16) throw new Error("Invalid envelope lengths");
  } catch (error) {
    const payloadError = new Error("加密数据格式无效，请稍后重试。", { cause: error });
    payloadError.code = "PAYLOAD_ENVELOPE_INVALID";
    throw payloadError;
  }

  let key;
  try {
    key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: envelope.iterations },
      passwordKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
    );
  } catch (error) {
    const payloadError = new Error("安全解锁暂时不可用，请稍后重试。", { cause: error });
    payloadError.code = "PAYLOAD_UNAVAILABLE";
    throw payloadError;
  }

  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, ciphertext);
  } catch (error) {
    if (error?.name === "OperationError") {
      const keyError = new Error("密码不正确，或加密数据已更换。", { cause: error });
      keyError.code = "UNLOCK_KEY_REJECTED";
      throw keyError;
    }
    const payloadError = new Error("加密数据暂时无法读取，请稍后重试。", { cause: error });
    payloadError.code = "PAYLOAD_UNAVAILABLE";
    throw payloadError;
  }

  try {
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (error) {
    const payloadError = new Error("解密数据格式无效，请稍后重试。", { cause: error });
    payloadError.code = "PAYLOAD_UNAVAILABLE";
    throw payloadError;
  }
}
// @app-block-end b044

// @app-block-start b045
export async function fetchEncryptedPayload(url, passwordKey) {
  let response;
  let envelope;
  try {
    response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    envelope = await response.json();
  } catch (error) {
    const payloadError = new Error("加密数据暂时无法读取，请稍后重试。", { cause: error });
    payloadError.code = "PAYLOAD_UNAVAILABLE";
    throw payloadError;
  }
  return decryptEnvelope(envelope, passwordKey);
}
// @app-block-end b045

// @app-block-start b046
export async function decryptPayload(password) {
  const key = await importUnlockKey(password);
  return { data: await fetchEncryptedPayload(payloadUrl, key), key };
}
// @app-block-end b046

// @app-block-start b047
export function formatUnlockExpiry(timestamp) {
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
// @app-block-end b047

// @app-block-start b048
export function renderUnlockPersistenceStatus() {
  const status = byId("unlock-session-status");
  if (!status) return;
  if (unlockPersistenceWarning) {
    status.textContent = "仅本页内存解锁 · 浏览器未保存会话";
    status.title = unlockPersistenceWarning;
    return;
  }
  if (unlockPersistenceRecord?.mode === "trusted") {
    status.textContent = `受信任设备 · 至 ${formatUnlockExpiry(unlockPersistenceRecord.expiresAt)}`;
    status.title = "刷新或重新打开浏览器时可自动恢复；可随时退出并忘记此设备。";
    return;
  }
  if (unlockPersistenceRecord?.mode === "session") {
    status.textContent = `当前浏览会话 · 至 ${formatUnlockExpiry(unlockPersistenceRecord.expiresAt)}`;
    status.title = "刷新可自动恢复；复制或恢复标签页时浏览器也可能继承本会话。";
    return;
  }
  status.textContent = "仅本页内存解锁";
  status.title = "页面刷新后需要重新输入密码。";
}
// @app-block-end b048
