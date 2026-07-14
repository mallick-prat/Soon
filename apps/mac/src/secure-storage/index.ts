/**
 * secure storage — sensitive payload columns are encrypted through this
 * interface. inside a packaged app, electron `safeStorage` (keychain-backed)
 * does the work; in tests / headless builds a clearly-marked passthrough
 * box is used instead. the electron import is lazy so unit tests never
 * touch electron.
 */

export type SecretBoxMode = "safeStorage" | "passthrough";

export interface SecretBox {
  readonly mode: SecretBoxMode;
  encryptString(plain: string): string;
  decryptString(payload: string): string;
}

const ENC_PREFIX = "enc:";
const PLAIN_PREFIX = "plain:";

/** test-mode passthrough — base64 with an explicit marker, no real crypto. */
export const createPassthroughBox = (): SecretBox => ({
  mode: "passthrough",
  encryptString: (plain) => PLAIN_PREFIX + Buffer.from(plain, "utf8").toString("base64"),
  decryptString: (payload) => {
    if (!payload.startsWith(PLAIN_PREFIX)) {
      throw new Error("passthrough box cannot decrypt this payload");
    }
    return Buffer.from(payload.slice(PLAIN_PREFIX.length), "base64").toString("utf8");
  },
});

interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
}

export const createSafeStorageBox = (safeStorage: SafeStorageLike): SecretBox => ({
  mode: "safeStorage",
  encryptString: (plain) => ENC_PREFIX + safeStorage.encryptString(plain).toString("base64"),
  decryptString: (payload) => {
    if (payload.startsWith(ENC_PREFIX)) {
      return safeStorage.decryptString(Buffer.from(payload.slice(ENC_PREFIX.length), "base64"));
    }
    if (payload.startsWith(PLAIN_PREFIX)) {
      // tolerate rows written before encryption became available.
      return Buffer.from(payload.slice(PLAIN_PREFIX.length), "base64").toString("utf8");
    }
    throw new Error("unrecognized secret payload format");
  },
});

/**
 * best available box: electron safeStorage when running inside electron
 * with encryption available, otherwise passthrough.
 */
export const createSecretBox = async (): Promise<SecretBox> => {
  try {
    const electron = (await import("electron")) as unknown as { safeStorage?: SafeStorageLike };
    const safeStorage = electron.safeStorage;
    if (safeStorage !== undefined && safeStorage.isEncryptionAvailable()) {
      return createSafeStorageBox(safeStorage);
    }
  } catch {
    // not running inside electron
  }
  return createPassthroughBox();
};
