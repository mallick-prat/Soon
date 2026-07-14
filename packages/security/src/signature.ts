import { createHmac, timingSafeEqual } from "node:crypto";
import { SignatureVerificationError } from "./errors.js";

/**
 * deterministic json canonicalization: object keys sorted lexicographically at
 * every depth, arrays kept in order, no whitespace. undefined object values are
 * dropped (matching JSON.stringify semantics) so optional fields never shift
 * the signature.
 */
export function canonicalJson(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : stringify(item))).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && typeof v !== "function")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  // undefined / function / symbol at the top level
  throw new SignatureVerificationError(`cannot canonicalize value of type ${typeof value}`);
}

/** hmac-sha256 over the canonical json string, base64url encoded */
export function signCommandPayload(canonical: string, secret: string | Buffer): string {
  return createHmac("sha256", secret).update(canonical, "utf8").digest("base64url");
}

/** constant-time verification of a signature produced by {@link signCommandPayload} */
export function verifyCommandSignature(
  canonical: string,
  signature: string,
  secret: string | Buffer,
): boolean {
  const expected = createHmac("sha256", secret).update(canonical, "utf8").digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * convenience: canonicalize an envelope with its `signature` field removed and
 * sign/verify it. this is the exact string the gateway signs commands over.
 */
export function canonicalEnvelopeString(envelope: Record<string, unknown>): string {
  const { signature: _omitted, ...rest } = envelope;
  return canonicalJson(rest);
}

export function signEnvelope(envelope: Record<string, unknown>, secret: string | Buffer): string {
  return signCommandPayload(canonicalEnvelopeString(envelope), secret);
}

export function verifyEnvelopeSignature(
  envelope: Record<string, unknown>,
  secret: string | Buffer,
): boolean {
  const signature = envelope["signature"];
  if (typeof signature !== "string" || signature.length === 0) return false;
  return verifyCommandSignature(canonicalEnvelopeString(envelope), signature, secret);
}
