import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTokenCipherForTests, tokenCipher } from "./integrations";

const KEY_B64 = Buffer.alloc(32, 7).toString("base64");

describe("tokenCipher (aes-256-gcm via @soon/security)", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY_B64;
    process.env.DATA_ENCRYPTION_KEY_VERSION = "1";
    resetTokenCipherForTests();
  });

  afterEach(() => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.DATA_ENCRYPTION_KEY_VERSION;
    resetTokenCipherForTests();
  });

  it("round-trips a token", () => {
    const token = "ya29.a0AfB_by-secret-refresh-token";
    expect(tokenCipher.decrypt(tokenCipher.encrypt(token))).toBe(token);
  });

  it("does not store the plaintext (real encryption, not the old stub)", () => {
    const token = "ya29.super-secret";
    const ciphertext = tokenCipher.encrypt(token);
    expect(ciphertext).not.toContain(token);
    expect(ciphertext).not.toContain("plaintext-stub");
    // versioned envelope format: v{version}.{iv}.{ct}.{tag}
    expect(ciphertext).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("produces a distinct ciphertext each time (random iv)", () => {
    const token = "same-token";
    expect(tokenCipher.encrypt(token)).not.toBe(tokenCipher.encrypt(token));
  });

  it("rejects a tampered ciphertext", () => {
    const ciphertext = tokenCipher.encrypt("token");
    const tampered = ciphertext.slice(0, -2) + (ciphertext.endsWith("AA") ? "BB" : "AA");
    expect(() => tokenCipher.decrypt(tampered)).toThrow();
  });

  it("refuses to operate without a key", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    resetTokenCipherForTests();
    expect(() => tokenCipher.encrypt("token")).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });
});
