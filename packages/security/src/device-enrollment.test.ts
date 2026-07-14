import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { JwtVerificationError } from "./errors.js";
import { mintDeviceJwt, verifyDeviceJwt } from "./device-jwt.js";
import {
  deviceProofMessage,
  mintEnrollmentToken,
  signDeviceProof,
  verifyDeviceProof,
  verifyEnrollmentToken,
} from "./device-enrollment.js";

const keypair = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
};

const SECRET = "device-jwt-secret-at-least-16-chars";

describe("device proof (ed25519)", () => {
  it("round-trips a valid proof", () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    const message = deviceProofMessage("dev-1", 1_784_000_000_000);
    const signature = signDeviceProof(privateKeyPem, message);
    expect(verifyDeviceProof(publicKeyPem, message, signature)).toBe(true);
  });

  it("rejects a tampered message", () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    const signature = signDeviceProof(privateKeyPem, deviceProofMessage("dev-1", 1_784_000_000_000));
    expect(verifyDeviceProof(publicKeyPem, deviceProofMessage("dev-1", 1_784_000_000_001), signature)).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const a = keypair();
    const b = keypair();
    const message = deviceProofMessage("dev-1", 1_784_000_000_000);
    const signature = signDeviceProof(a.privateKeyPem, message);
    expect(verifyDeviceProof(b.publicKeyPem, message, signature)).toBe(false);
  });

  it("returns false (never throws) on a malformed public key", () => {
    expect(verifyDeviceProof("not-a-pem", "msg", "c2ln")).toBe(false);
  });
});

describe("enrollment token", () => {
  it("round-trips the enrolling user", async () => {
    const token = await mintEnrollmentToken({ userId: "user-1", secret: SECRET });
    expect(await verifyEnrollmentToken(token, { secret: SECRET })).toEqual({ userId: "user-1" });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await mintEnrollmentToken({ userId: "user-1", secret: SECRET });
    await expect(verifyEnrollmentToken(token, { secret: "other-secret-16-chars" })).rejects.toBeInstanceOf(
      JwtVerificationError,
    );
  });

  it("rejects an expired token", async () => {
    const token = await mintEnrollmentToken({ userId: "user-1", secret: SECRET, expiresInSeconds: -1 });
    await expect(verifyEnrollmentToken(token, { secret: SECRET })).rejects.toMatchObject({ reason: "expired" });
  });
});

describe("device access token → gateway contract", () => {
  it("mints a token the gateway verifier accepts, with the routing claims", async () => {
    // register mints with the shared secret + deviceId = mac_devices.id;
    // the gateway verifies with the same secret and routes on deviceId.
    const token = await mintDeviceJwt({ deviceId: "macdev-1", userId: "user-1", secret: SECRET });
    const claims = await verifyDeviceJwt(token, { secret: SECRET });
    expect(claims.deviceId).toBe("macdev-1");
    expect(claims.userId).toBe("user-1");
  });

  it("the gateway rejects a token signed with a different secret", async () => {
    const token = await mintDeviceJwt({ deviceId: "macdev-1", userId: "user-1", secret: SECRET });
    await expect(verifyDeviceJwt(token, { secret: "a-different-secret-16ch" })).rejects.toBeInstanceOf(
      JwtVerificationError,
    );
  });
})
