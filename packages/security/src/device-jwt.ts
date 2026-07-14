import { SignJWT, jwtVerify, importPKCS8, importSPKI, errors as joseErrors } from "jose";
import type { CryptoKey, KeyObject } from "jose";
import { JwtVerificationError } from "./errors.js";

const ISSUER = "soon";
const AUDIENCE = "soon:realtime-gateway";
const DEFAULT_TTL_SECONDS = 10 * 60;

export type DeviceJwtAlgorithm = "EdDSA" | "ES256" | "HS256";

export interface MintDeviceJwtInput {
  deviceId: string;
  userId: string;
  /** pkcs8 pem private key — used with EdDSA (default) or ES256 */
  privateKeyPem?: string;
  /** shared secret fallback — used with HS256 */
  secret?: string;
  /** explicit algorithm; inferred otherwise (pem → EdDSA, then ES256; secret → HS256) */
  algorithm?: DeviceJwtAlgorithm;
  /** ttl in seconds, defaults to 600 (10 minutes) */
  expiresInSeconds?: number;
}

export interface DeviceJwtClaims {
  deviceId: string;
  userId: string;
  /** unix seconds */
  expiresAt: number;
  /** unix seconds */
  issuedAt: number;
}

export interface VerifyDeviceJwtKeys {
  /** spki pem public key for EdDSA/ES256 tokens */
  publicKeyPem?: string;
  /** shared secret for HS256 tokens */
  secret?: string;
  /** restrict accepted algorithms; inferred from provided material otherwise */
  algorithms?: DeviceJwtAlgorithm[];
}

async function importPrivateKey(
  pem: string,
  algorithm?: DeviceJwtAlgorithm,
): Promise<{ key: CryptoKey | KeyObject; alg: "EdDSA" | "ES256" }> {
  if (algorithm === "HS256") {
    throw new JwtVerificationError("hs256 requires a secret, not a pem key", "malformed");
  }
  const candidates: Array<"EdDSA" | "ES256"> = algorithm ? [algorithm] : ["EdDSA", "ES256"];
  let lastError: unknown;
  for (const alg of candidates) {
    try {
      const key = await importPKCS8(pem, alg);
      return { key, alg };
    } catch (error) {
      lastError = error;
    }
  }
  throw new JwtVerificationError(
    `could not import private key: ${lastError instanceof Error ? lastError.message : "unknown"}`,
    "malformed",
  );
}

/** mint a short-lived (default 10 min) device jwt. prefers EdDSA/ES256 pem keys, falls back to hs256 secret. */
export async function mintDeviceJwt(input: MintDeviceJwtInput): Promise<string> {
  const { deviceId, userId, privateKeyPem, secret } = input;
  if (!deviceId || !userId) {
    throw new JwtVerificationError("deviceId and userId are required", "missing_claims");
  }
  const ttl = input.expiresInSeconds ?? DEFAULT_TTL_SECONDS;
  const builder = new SignJWT({ deviceId, userId })
    .setSubject(deviceId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .setJti(crypto.randomUUID());

  if (privateKeyPem) {
    const { key, alg } = await importPrivateKey(privateKeyPem, input.algorithm);
    return builder.setProtectedHeader({ alg }).sign(key);
  }
  if (secret) {
    return builder
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode(secret));
  }
  throw new JwtVerificationError("either privateKeyPem or secret is required", "malformed");
}

async function importVerificationKey(
  keys: VerifyDeviceJwtKeys,
): Promise<{ key: CryptoKey | KeyObject | Uint8Array; algorithms: DeviceJwtAlgorithm[] }> {
  if (keys.publicKeyPem) {
    const candidates: Array<"EdDSA" | "ES256"> = (keys.algorithms?.filter(
      (a): a is "EdDSA" | "ES256" => a !== "HS256",
    ) ?? ["EdDSA", "ES256"]) as Array<"EdDSA" | "ES256">;
    let lastError: unknown;
    for (const alg of candidates) {
      try {
        const key = await importSPKI(keys.publicKeyPem, alg);
        return { key, algorithms: [alg] };
      } catch (error) {
        lastError = error;
      }
    }
    throw new JwtVerificationError(
      `could not import public key: ${lastError instanceof Error ? lastError.message : "unknown"}`,
      "malformed",
    );
  }
  if (keys.secret) {
    return { key: new TextEncoder().encode(keys.secret), algorithms: ["HS256"] };
  }
  throw new JwtVerificationError("either publicKeyPem or secret is required", "malformed");
}

/** verify a device jwt and return typed claims. throws {@link JwtVerificationError}. */
export async function verifyDeviceJwt(
  token: string,
  keys: VerifyDeviceJwtKeys,
): Promise<DeviceJwtClaims> {
  const { key, algorithms } = await importVerificationKey(keys);
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms,
    });
    const deviceId = payload["deviceId"];
    const userId = payload["userId"];
    if (typeof deviceId !== "string" || typeof userId !== "string") {
      throw new JwtVerificationError("token is missing deviceId/userId claims", "missing_claims");
    }
    if (typeof payload.exp !== "number" || typeof payload.iat !== "number") {
      throw new JwtVerificationError("token is missing exp/iat claims", "missing_claims");
    }
    return { deviceId, userId, expiresAt: payload.exp, issuedAt: payload.iat };
  } catch (error) {
    if (error instanceof JwtVerificationError) throw error;
    if (error instanceof joseErrors.JWTExpired) {
      throw new JwtVerificationError("token is expired", "expired");
    }
    if (
      error instanceof joseErrors.JWSSignatureVerificationFailed ||
      error instanceof joseErrors.JWTClaimValidationFailed
    ) {
      throw new JwtVerificationError("token signature or claims invalid", "invalid_signature");
    }
    throw new JwtVerificationError(
      `token could not be verified: ${error instanceof Error ? error.message : "unknown"}`,
      "malformed",
    );
  }
}
