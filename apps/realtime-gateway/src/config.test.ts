import { describe, expect, it } from "vitest";
import { EnvValidationError } from "@soon/security";
import { loadConfig } from "./config.js";

const validEnv = {
  PORT: "9090",
  INTERNAL_API_TOKEN: "internal-token-for-tests-1234",
  DEVICE_SIGNING_SECRET: "device-signing-secret-tests",
  DEVICE_JWT_SECRET: "device-jwt-secret-for-tests",
};

describe("loadConfig", () => {
  it("parses a valid environment with defaults", () => {
    const config = loadConfig(validEnv);
    expect(config.PORT).toBe(9090);
    expect(config.NODE_ENV).toBe("production");
  });

  it("accepts a jwt public key instead of a shared secret", () => {
    const { DEVICE_JWT_SECRET: _omit, ...rest } = validEnv;
    const config = loadConfig({ ...rest, REALTIME_JWT_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----" });
    expect(config.REALTIME_JWT_PUBLIC_KEY).toBeDefined();
  });

  it("requires at least one jwt verification key", () => {
    const { DEVICE_JWT_SECRET: _omit, ...rest } = validEnv;
    expect(() => loadConfig(rest)).toThrow(EnvValidationError);
  });

  it("names missing variables without leaking values", () => {
    try {
      loadConfig({ PORT: "not-a-port" });
      expect.unreachable();
    } catch (error) {
      const e = error as EnvValidationError;
      expect(e).toBeInstanceOf(EnvValidationError);
      expect(e.variables).toContain("INTERNAL_API_TOKEN");
      expect(e.message).not.toContain("not-a-port");
    }
  });
});
