import { describe, expect, it } from "vitest";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  DecryptionFailedError,
  EnvValidationError,
  JwtVerificationError,
  MalformedPayloadError,
  UnknownKeyVersionError,
  canonicalJson,
  decryptSecret,
  deriveKeyFromMasterKey,
  encryptSecret,
  mintDeviceJwt,
  requireEnv,
  signCommandPayload,
  signEnvelope,
  verifyCommandSignature,
  verifyDeviceJwt,
  verifyEnvelopeSignature,
} from "./index.js";

const masterKeyB64 = randomBytes(32).toString("base64");
const key = deriveKeyFromMasterKey(masterKeyB64);

describe("envelope encryption", () => {
  it("round-trips a secret", () => {
    const payload = encryptSecret("super secret refresh token", key, 1);
    expect(payload).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$/);
    expect(decryptSecret(payload, key)).toBe("super secret refresh token");
  });

  it("round-trips unicode and empty-ish plaintexts", () => {
    for (const plaintext of ["", "héllo wörld 🤝", "a".repeat(10_000)]) {
      expect(decryptSecret(encryptSecret(plaintext, key, 3), key)).toBe(plaintext);
    }
  });

  it("produces unique ivs per call", () => {
    const a = encryptSecret("same", key, 1);
    const b = encryptSecret("same", key, 1);
    expect(a).not.toBe(b);
  });

  it("detects a tampered ciphertext", () => {
    const payload = encryptSecret("tamper me", key, 1);
    const parts = payload.split(".");
    const ct = Buffer.from(parts[2]!, "base64url");
    ct[0] = ct[0]! ^ 0xff;
    parts[2] = ct.toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow(DecryptionFailedError);
  });

  it("detects a tampered auth tag", () => {
    const payload = encryptSecret("tamper me", key, 1);
    const parts = payload.split(".");
    const tag = Buffer.from(parts[3]!, "base64url");
    tag[0] = tag[0]! ^ 0x01;
    parts[3] = tag.toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow(DecryptionFailedError);
  });

  it("rejects the wrong key", () => {
    const payload = encryptSecret("secret", key, 1);
    const wrongKey = deriveKeyFromMasterKey(randomBytes(32).toString("base64"));
    expect(() => decryptSecret(payload, wrongKey)).toThrow(DecryptionFailedError);
  });

  it("supports key-version-aware decryption via a key ring", () => {
    const keyV2 = deriveKeyFromMasterKey(randomBytes(32).toString("base64"));
    const ring = new Map([
      [1, key],
      [2, keyV2],
    ]);
    const oldPayload = encryptSecret("rotated secret", key, 1);
    const newPayload = encryptSecret("rotated secret", keyV2, 2);
    expect(decryptSecret(oldPayload, ring)).toBe("rotated secret");
    expect(decryptSecret(newPayload, ring)).toBe("rotated secret");
    // record-shaped ring works too
    expect(decryptSecret(newPayload, { 1: key, 2: keyV2 })).toBe("rotated secret");
  });

  it("throws for an unknown key version", () => {
    const payload = encryptSecret("secret", key, 7);
    expect(() => decryptSecret(payload, new Map([[1, key]]))).toThrow(UnknownKeyVersionError);
  });

  it("throws for malformed payloads", () => {
    expect(() => decryptSecret("not-a-payload", key)).toThrow(MalformedPayloadError);
    expect(() => decryptSecret("v1.only.three", key)).toThrow(MalformedPayloadError);
  });

  it("derives a stable 32-byte key from short base64 input", () => {
    const a = deriveKeyFromMasterKey(Buffer.from("short").toString("base64"));
    const b = deriveKeyFromMasterKey(Buffer.from("short").toString("base64"));
    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(true);
  });
});

describe("device jwt", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  it("mints and verifies an eddsa jwt with typed claims", async () => {
    const token = await mintDeviceJwt({ deviceId: "dev-1", userId: "user-1", privateKeyPem });
    const claims = await verifyDeviceJwt(token, { publicKeyPem });
    expect(claims.deviceId).toBe("dev-1");
    expect(claims.userId).toBe("user-1");
    expect(claims.expiresAt - claims.issuedAt).toBe(600);
  });

  it("mints and verifies an hs256 jwt with a shared secret", async () => {
    const token = await mintDeviceJwt({ deviceId: "dev-2", userId: "user-2", secret: "s3cret" });
    const claims = await verifyDeviceJwt(token, { secret: "s3cret" });
    expect(claims.deviceId).toBe("dev-2");
  });

  it("supports es256 pem keys", async () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const token = await mintDeviceJwt({
      deviceId: "dev-3",
      userId: "user-3",
      privateKeyPem: ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    });
    const claims = await verifyDeviceJwt(token, {
      publicKeyPem: ec.publicKey.export({ type: "spki", format: "pem" }).toString(),
    });
    expect(claims.deviceId).toBe("dev-3");
  });

  it("rejects an expired jwt with a typed reason", async () => {
    const token = await mintDeviceJwt({
      deviceId: "dev-1",
      userId: "user-1",
      privateKeyPem,
      expiresInSeconds: -60,
    });
    await expect(verifyDeviceJwt(token, { publicKeyPem })).rejects.toMatchObject({
      name: "JwtVerificationError",
      reason: "expired",
    });
  });

  it("rejects a jwt signed with a different key", async () => {
    const other = generateKeyPairSync("ed25519");
    const token = await mintDeviceJwt({
      deviceId: "dev-1",
      userId: "user-1",
      privateKeyPem: other.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    });
    await expect(verifyDeviceJwt(token, { publicKeyPem })).rejects.toBeInstanceOf(
      JwtVerificationError,
    );
  });

  it("rejects garbage tokens", async () => {
    await expect(verifyDeviceJwt("not.a.jwt", { publicKeyPem })).rejects.toBeInstanceOf(
      JwtVerificationError,
    );
  });

  it("rejects an hs256 token when only a public key is accepted", async () => {
    const token = await mintDeviceJwt({ deviceId: "d", userId: "u", secret: "shared" });
    await expect(verifyDeviceJwt(token, { publicKeyPem })).rejects.toBeInstanceOf(
      JwtVerificationError,
    );
  });
});

describe("command signatures", () => {
  const secret = "device-signing-secret";

  it("canonicalization is stable across key order", () => {
    const a = canonicalJson({ b: 2, a: 1, nested: { z: [1, 2], y: "x" } });
    const b = canonicalJson({ nested: { y: "x", z: [1, 2] }, a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":1,"b":2,"nested":{"y":"x","z":[1,2]}}');
  });

  it("drops undefined values so optional fields do not shift signatures", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it("signs and verifies deterministically", () => {
    const canonical = canonicalJson({ commandId: "c1", type: "ping" });
    const sig = signCommandPayload(canonical, secret);
    expect(sig).toBe(signCommandPayload(canonical, secret));
    expect(verifyCommandSignature(canonical, sig, secret)).toBe(true);
  });

  it("rejects a signature mismatch", () => {
    const canonical = canonicalJson({ commandId: "c1" });
    const sig = signCommandPayload(canonical, secret);
    expect(verifyCommandSignature(canonical, sig, "wrong-secret")).toBe(false);
    expect(verifyCommandSignature(canonicalJson({ commandId: "c2" }), sig, secret)).toBe(false);
    expect(verifyCommandSignature(canonical, "tampered", secret)).toBe(false);
    expect(verifyCommandSignature(canonical, "", secret)).toBe(false);
  });

  it("envelope helpers sign everything except the signature field", () => {
    const envelope: Record<string, unknown> = { commandId: "c1", type: "ping", payload: {} };
    envelope["signature"] = signEnvelope(envelope, secret);
    expect(verifyEnvelopeSignature(envelope, secret)).toBe(true);
    expect(verifyEnvelopeSignature({ ...envelope, commandId: "c2" }, secret)).toBe(false);
    expect(verifyEnvelopeSignature({ ...envelope, signature: undefined }, secret)).toBe(false);
  });
});

describe("requireEnv", () => {
  const schema = z.object({
    PORT: z.coerce.number().int(),
    API_TOKEN: z.string().min(8),
  });

  it("parses a valid environment", () => {
    const env = requireEnv(schema, { PORT: "8080", API_TOKEN: "long-enough-token" });
    expect(env.PORT).toBe(8080);
  });

  it("names offending variables without leaking values", () => {
    try {
      requireEnv(schema, { PORT: "nope", API_TOKEN: "short" });
      expect.unreachable();
    } catch (error) {
      const e = error as EnvValidationError;
      expect(e).toBeInstanceOf(EnvValidationError);
      expect(e.variables).toContain("PORT");
      expect(e.variables).toContain("API_TOKEN");
      expect(e.message).not.toContain("nope");
      expect(e.message).not.toContain("short");
    }
  });
});
