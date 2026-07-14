/**
 * device enrollment primitives.
 *
 * a headless mac companion cannot present a browser session, so enrollment is
 * two-legged:
 *  1. the dashboard (user is signed in) mints a short-lived ENROLLMENT TOKEN.
 *  2. the mac exchanges it for a device access jwt at registration, presenting
 *     its public key (trust-on-first-use).
 * thereafter the mac refreshes its access jwt by signing a challenge with its
 * device private key — verified here against the stored public key.
 *
 * the enrollment token uses a distinct audience so it can never be replayed as
 * a gateway access token (that is minted by mintDeviceJwt with a different aud).
 */
import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from "node:crypto";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";

import { JwtVerificationError } from "./errors.js";

const ENROLLMENT_ISSUER = "soon";
const ENROLLMENT_AUDIENCE = "soon:device-enrollment";
const DEFAULT_ENROLLMENT_TTL_SECONDS = 10 * 60;

// -------------------------------------------------------------- device proof

/** canonical message the device signs to prove control of its key. */
export function deviceProofMessage(deviceId: string, issuedAtMs: number): string {
  return `soon-device-proof:${deviceId}:${issuedAtMs}`;
}

/** sign a proof message with an ed25519 pkcs8 pem private key (mac side / tests). */
export function signDeviceProof(privateKeyPkcs8Pem: string, message: string): string {
  const key = createPrivateKey(privateKeyPkcs8Pem);
  return nodeSign(null, Buffer.from(message, "utf8"), key).toString("base64");
}

/** verify a device proof signature against an ed25519 spki pem public key. */
export function verifyDeviceProof(
  publicKeySpkiPem: string,
  message: string,
  signatureB64: string,
): boolean {
  try {
    const key = createPublicKey(publicKeySpkiPem);
    return nodeVerify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------- enrollment token

export interface MintEnrollmentTokenInput {
  userId: string;
  /** shared secret (DEVICE_JWT_SECRET) */
  secret: string;
  expiresInSeconds?: number;
}

/** mint a short-lived enrollment token binding a device registration to a user. */
export async function mintEnrollmentToken(input: MintEnrollmentTokenInput): Promise<string> {
  if (!input.userId) {
    throw new JwtVerificationError("userId is required", "missing_claims");
  }
  return new SignJWT({ userId: input.userId, purpose: "enrollment" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ENROLLMENT_ISSUER)
    .setAudience(ENROLLMENT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${input.expiresInSeconds ?? DEFAULT_ENROLLMENT_TTL_SECONDS}s`)
    .setJti(crypto.randomUUID())
    .sign(new TextEncoder().encode(input.secret));
}

/** verify an enrollment token and return the enrolling user. */
export async function verifyEnrollmentToken(
  token: string,
  keys: { secret: string },
): Promise<{ userId: string }> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(keys.secret), {
      issuer: ENROLLMENT_ISSUER,
      audience: ENROLLMENT_AUDIENCE,
      algorithms: ["HS256"],
    });
    const userId = payload["userId"];
    if (typeof userId !== "string" || payload["purpose"] !== "enrollment") {
      throw new JwtVerificationError("enrollment token is missing claims", "missing_claims");
    }
    return { userId };
  } catch (error) {
    if (error instanceof JwtVerificationError) throw error;
    if (error instanceof joseErrors.JWTExpired) {
      throw new JwtVerificationError("enrollment token is expired", "expired");
    }
    throw new JwtVerificationError("enrollment token is invalid", "invalid_signature");
  }
}
