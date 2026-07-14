import { describe, expect, it } from "vitest";
import {
  deviceProofMessage,
  mintEnrollmentToken,
  verifyDeviceProof,
  verifyEnrollmentToken,
} from "@soon/security";

import { openLocalDatabase } from "../local-database/db.js";
import { SettingsStore } from "../local-database/stores.js";
import { createPassthroughBox } from "../secure-storage/index.js";
import { DeviceEnroller, EnrollmentError, type HttpPost } from "./enroller.js";
import { createSettingsEnrollmentStore } from "./store.js";

const SECRET = "device-jwt-secret-at-least-16-chars";
const THIRTY_DAYS_S = 30 * 24 * 60 * 60;

/** a fake backend that verifies with the REAL @soon/security primitives. */
function fakeBackend() {
  let registeredPublicKey: string | null = null;
  const refreshCalls: Array<{ deviceId: string; issuedAtMs: number }> = [];
  const post: HttpPost = async (path, body) => {
    if (path === "/api/devices/register") {
      const b = body as { enrollmentToken: string; devicePublicKey: string };
      try {
        await verifyEnrollmentToken(b.enrollmentToken, { secret: SECRET });
      } catch {
        return { status: 401, json: { error: "invalid_enrollment_token" } };
      }
      registeredPublicKey = b.devicePublicKey;
      return {
        status: 201,
        json: { device: { id: "macdev-1" }, token: "access-token-1", expiresInSeconds: THIRTY_DAYS_S },
      };
    }
    if (path === "/api/devices/token") {
      const b = body as { deviceId: string; issuedAtMs: number; signature: string };
      refreshCalls.push({ deviceId: b.deviceId, issuedAtMs: b.issuedAtMs });
      if (registeredPublicKey === null) return { status: 401, json: {} };
      const ok = verifyDeviceProof(
        registeredPublicKey,
        deviceProofMessage(b.deviceId, b.issuedAtMs),
        b.signature,
      );
      if (!ok) return { status: 401, json: { error: "invalid_proof" } };
      return { status: 200, json: { token: `refreshed-${b.issuedAtMs}`, expiresInSeconds: THIRTY_DAYS_S } };
    }
    return { status: 404, json: {} };
  };
  return { post, refreshCalls, registeredPublicKey: () => registeredPublicKey };
}

function harness() {
  const opened = openLocalDatabase(":memory:");
  const settings = new SettingsStore(opened.db);
  settings.init(1_784_000_000_000);
  const store = createSettingsEnrollmentStore(settings, createPassthroughBox());
  const backend = fakeBackend();
  let t = 1_784_000_000_000;
  const enroller = new DeviceEnroller({ store, post: backend.post, now: () => t });
  return { settings, store, backend, enroller, advance: (ms: number) => (t += ms), now: () => t };
}

describe("DeviceEnroller", () => {
  it("registers, stores the server device id, and caches the access token", async () => {
    const h = harness();
    const code = await mintEnrollmentToken({ userId: "user-1", secret: SECRET });

    expect(h.enroller.isEnrolled()).toBe(false);
    const { serverDeviceId } = await h.enroller.register(code);
    expect(serverDeviceId).toBe("macdev-1");
    expect(h.enroller.isEnrolled()).toBe(true);

    // the server device id also becomes the event deviceId (gateway routes on it).
    expect(h.settings.get().deviceId).toBe("macdev-1");
    // a real ed25519 public key was generated and presented.
    expect(h.backend.registeredPublicKey()).toContain("BEGIN PUBLIC KEY");

    // fresh token is returned from cache — no refresh call.
    expect(await h.enroller.getAccessToken()).toBe("access-token-1");
    expect(h.backend.refreshCalls).toHaveLength(0);
  });

  it("refreshes with a valid device proof once the token nears expiry", async () => {
    const h = harness();
    const code = await mintEnrollmentToken({ userId: "user-1", secret: SECRET });
    await h.enroller.register(code);

    // jump to within the refresh window of expiry.
    h.advance(THIRTY_DAYS_S * 1000 - 60_000);
    const token = await h.enroller.getAccessToken();

    expect(token).toBe(`refreshed-${h.now()}`);
    expect(h.backend.refreshCalls).toHaveLength(1);
    expect(h.backend.refreshCalls[0]!.deviceId).toBe("macdev-1");
    // subsequent call is cached again.
    expect(await h.enroller.getAccessToken()).toBe(token);
    expect(h.backend.refreshCalls).toHaveLength(1);
  });

  it("rejects an invalid enrollment code", async () => {
    const h = harness();
    await expect(h.enroller.register("not-a-real-code")).rejects.toBeInstanceOf(EnrollmentError);
    expect(h.enroller.isEnrolled()).toBe(false);
  });

  it("throws when asked for a token before enrollment", async () => {
    const h = harness();
    await expect(h.enroller.getAccessToken()).rejects.toMatchObject({ status: 0 });
  });
});
