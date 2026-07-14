import { describe, expect, it } from "vitest";

import { loadDrainerConfigFromEnv, startOutboxDrainer } from "./bootstrap.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("loadDrainerConfigFromEnv", () => {
  it("builds config from a complete environment", () => {
    const config = loadDrainerConfigFromEnv({
      SOON_GATEWAY_URL: "https://gateway.test",
      INTERNAL_API_TOKEN: "token",
      DEVICE_SIGNING_SECRET: "secret",
      OUTBOX_DRAIN_BATCH_SIZE: "25",
    });
    expect(config.gatewayUrl).toBe("https://gateway.test");
    expect(config.internalToken).toBe("token");
    expect(config.signingSecret).toBe("secret");
    expect(config.batchSize).toBe(25);
  });

  it("falls back to GATEWAY_URL and omits an invalid batch size", () => {
    const config = loadDrainerConfigFromEnv({
      GATEWAY_URL: "https://gw",
      INTERNAL_API_TOKEN: "token",
      DEVICE_SIGNING_SECRET: "secret",
      OUTBOX_DRAIN_BATCH_SIZE: "not-a-number",
    });
    expect(config.gatewayUrl).toBe("https://gw");
    expect(config.batchSize).toBeUndefined();
  });

  it("throws naming every missing variable", () => {
    expect(() => loadDrainerConfigFromEnv({})).toThrow(
      /SOON_GATEWAY_URL.*INTERNAL_API_TOKEN.*DEVICE_SIGNING_SECRET/,
    );
  });
});

describe("startOutboxDrainer", () => {
  it("drains repeatedly until stopped", async () => {
    let calls = 0;
    const handle = startOutboxDrainer(
      {
        gatewayUrl: "x",
        internalToken: "x",
        signingSecret: "x",
        fetchPending: async () => {
          calls += 1;
          return [];
        },
      },
      { intervalMs: 5 },
    );

    await sleep(40);
    handle.stop();
    const afterStop = calls;
    expect(afterStop).toBeGreaterThanOrEqual(2);

    await sleep(25);
    expect(calls).toBe(afterStop); // no further drains after stop()
  });
});
