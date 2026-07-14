/**
 * integration seam between the web control plane and the workspace engines.
 *
 * these were placeholder stubs while the packages were built concurrently;
 * they are now wired to the real implementations. keep this module thin — it
 * only adapts the packages to the shapes the api routes expect.
 */
import {
  deriveKeyFromMasterKey,
  encryptSecret,
  decryptSecret,
  type KeyRing,
} from "@soon/security";
import { createLogger } from "@soon/observability";

// --------------------------------------------------------------------------
// token encryption — @soon/security aes-256-gcm envelope encryption.
// protects google access/refresh tokens at rest (prisma
// GoogleConnection.encrypted*Token). the master key comes from
// TOKEN_ENCRYPTION_KEY (base64); the version from DATA_ENCRYPTION_KEY_VERSION.
// --------------------------------------------------------------------------
export interface TokenCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

interface TokenKeyMaterial {
  version: number;
  key: Buffer;
  ring: KeyRing;
}

let cachedKeyMaterial: TokenKeyMaterial | null = null;

/**
 * load and cache the token key material. throws a clear error — never
 * exposing the key — if the environment is missing or malformed. called
 * lazily so importing this module never requires a key (local/demo mode).
 */
function tokenKeyMaterial(): TokenKeyMaterial {
  if (cachedKeyMaterial) return cachedKeyMaterial;
  const master = process.env.TOKEN_ENCRYPTION_KEY;
  if (!master) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set; refusing to store google tokens without encryption",
    );
  }
  const version = Number(process.env.DATA_ENCRYPTION_KEY_VERSION ?? "1");
  if (!Number.isInteger(version) || version < 0) {
    throw new Error("DATA_ENCRYPTION_KEY_VERSION must be a non-negative integer");
  }
  const key = deriveKeyFromMasterKey(master);
  cachedKeyMaterial = { version, key, ring: { [version]: key } };
  return cachedKeyMaterial;
}

export const tokenCipher: TokenCipher = {
  encrypt: (plaintext) => {
    const { key, version } = tokenKeyMaterial();
    return encryptSecret(plaintext, key, version);
  },
  decrypt: (ciphertext) => {
    const { ring } = tokenKeyMaterial();
    return decryptSecret(ciphertext, ring);
  },
};

/** test seam: clears the memoized key material so env changes take effect. */
export function resetTokenCipherForTests(): void {
  cachedKeyMaterial = null;
}

// --------------------------------------------------------------------------
// structured logging — @soon/observability pino logger with mandatory
// redaction of tokens, message bodies, emails, and phone numbers. adapted to
// the (message, fields) shape the api routes already call.
// --------------------------------------------------------------------------
export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const pinoLogger = createLogger({ name: "web" });

export const logger: Logger = {
  info: (message, fields) => pinoLogger.info(fields ?? {}, message),
  warn: (message, fields) => pinoLogger.warn(fields ?? {}, message),
  error: (message, fields) => pinoLogger.error(fields ?? {}, message),
};
