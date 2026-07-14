import { describe, expect, it } from "vitest";

import type { OutboxDrainerConfig } from "./adapters/outbox-drainer.js";
import { startDrainerService } from "./main.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("startDrainerService", () => {
  it("drains on an interval and stops cleanly", async () => {
    let calls = 0;
    const config: OutboxDrainerConfig = {
      gatewayUrl: "https://gateway.test",
      internalToken: "token",
      signingSecret: "secret",
      fetchPending: async () => {
        calls += 1;
        return [];
      },
    };

    const service = startDrainerService({ config, intervalMs: 5 });
    await sleep(40);
    await service.stop();
    const afterStop = calls;
    expect(afterStop).toBeGreaterThanOrEqual(2);

    await sleep(25);
    expect(calls).toBe(afterStop); // loop halted after stop()
  });

  it("stop() is idempotent", async () => {
    const service = startDrainerService({
      config: {
        gatewayUrl: "x",
        internalToken: "x",
        signingSecret: "x",
        fetchPending: async () => [],
      },
      intervalMs: 5,
    });
    await service.stop();
    await expect(service.stop()).resolves.toBeUndefined();
  });
});
