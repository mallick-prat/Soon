import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  DecryptionFailedError,
  MalformedPayloadError,
  UnknownKeyVersionError,
} from "./errors.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * derive a 32-byte aes key from a base64 (or base64url) master key env value.
 * if the decoded value is already exactly 32 bytes it is used directly;
 * otherwise it is stretched/compressed deterministically via sha-256.
 */
export function deriveKeyFromMasterKey(masterKeyB64: string): Buffer {
  const trimmed = masterKeyB64.trim();
  if (trimmed.length === 0) {
    throw new MalformedPayloadError("master key is empty");
  }
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 0) {
    throw new MalformedPayloadError("master key is not valid base64");
  }
  if (decoded.length === KEY_BYTES) return decoded;
  return createHash("sha256").update(decoded).digest();
}

/** map of key version → 32-byte key, used for rotation-aware decryption */
export type KeyRing = ReadonlyMap<number, Buffer> | Readonly<Record<number, Buffer>>;

function lookupKey(keys: Buffer | KeyRing, version: number): Buffer {
  if (Buffer.isBuffer(keys)) return keys;
  const key = keys instanceof Map ? keys.get(version) : (keys as Record<number, Buffer>)[version];
  if (!key) throw new UnknownKeyVersionError(version);
  return key;
}

const PAYLOAD_RE = /^v(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)\.([A-Za-z0-9_-]+)$/;

/**
 * encrypt a secret with aes-256-gcm.
 * output format: `v{keyVersion}.{iv_b64url}.{ciphertext_b64url}.{tag_b64url}`
 */
export function encryptSecret(plaintext: string, key: Buffer, keyVersion: number): string {
  if (!Number.isInteger(keyVersion) || keyVersion < 0) {
    throw new MalformedPayloadError("key version must be a non-negative integer");
  }
  if (key.length !== KEY_BYTES) {
    throw new MalformedPayloadError(`key must be exactly ${KEY_BYTES} bytes`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    `v${keyVersion}`,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

/**
 * decrypt a payload produced by {@link encryptSecret}.
 * pass a single key, or a version-keyed ring (map or record) to support rotation.
 */
export function decryptSecret(payload: string, keys: Buffer | KeyRing): string {
  const match = PAYLOAD_RE.exec(payload);
  if (!match) throw new MalformedPayloadError();
  const [, versionStr, ivB64, ctB64, tagB64] = match;
  const version = Number(versionStr);
  const key = lookupKey(keys, version);
  if (key.length !== KEY_BYTES) {
    throw new MalformedPayloadError(`key must be exactly ${KEY_BYTES} bytes`);
  }
  const iv = Buffer.from(ivB64 ?? "", "base64url");
  const tag = Buffer.from(tagB64 ?? "", "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new MalformedPayloadError("iv or auth tag has an unexpected length");
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ctB64 ?? "", "base64url")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    throw new DecryptionFailedError();
  }
}
