import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type Gateway } from "./app.js";
import { InMemoryCommandStore } from "./store.js";
import {
  TEST_INTERNAL_TOKEN,
  makeCommand,
  silentLogger,
  testConfig,
} from "./test-helpers.js";

const gateways: Gateway[] = [];

async function makeGateway(): Promise<Gateway> {
  const gateway = await buildApp({
    config: testConfig(),
    logger: silentLogger(),
    store: new InMemoryCommandStore(),
    dispatch: { attempts: 1, baseDelayMs: 1, sleep: async () => {} },
  });
  gateways.push(gateway);
  return gateway;
}

afterEach(async () => {
  while (gateways.length > 0) await gateways.pop()?.app.close();
});

const authHeader = { authorization: `Bearer ${TEST_INTERNAL_TOKEN}` };

describe("GET /health", () => {
  it("reports status, uptime, and connected device count", async () => {
    const { app } = await makeGateway();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(body.connectedDevices).toBe(0);
  });
});

describe("POST /internal/commands auth", () => {
  it("rejects a missing bearer token", async () => {
    const { app } = await makeGateway();
    const res = await app.inject({ method: "POST", url: "/internal/commands", payload: makeCommand() });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a wrong bearer token", async () => {
    const { app } = await makeGateway();
    const res = await app.inject({
      method: "POST",
      url: "/internal/commands",
      headers: { authorization: "Bearer wrong-token-wrong-token" },
      payload: makeCommand(),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /internal/commands validation", () => {
  it("rejects a schema-invalid command naming only field paths", async () => {
    const { app } = await makeGateway();
    const res = await app.inject({
      method: "POST",
      url: "/internal/commands",
      headers: authHeader,
      payload: { type: "ping", commandId: "c1" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("invalid_command");
    expect(Array.isArray(body.fields)).toBe(true);
    expect(body.fields.length).toBeGreaterThan(0);
  });

  it("rejects a command with a bad hmac signature", async () => {
    const { app, store } = await makeGateway();
    const command = makeCommand({ signature: "forged-signature" });
    const res = await app.inject({
      method: "POST",
      url: "/internal/commands",
      headers: authHeader,
      payload: command,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("invalid_signature");
    expect(await store.getCommand(command.commandId)).toBeUndefined();
  });

  it("rejects a signed command whose fields were tampered after signing", async () => {
    const { app } = await makeGateway();
    const command = makeCommand();
    const tampered = { ...command, deviceId: "attacker-device" };
    const res = await app.inject({
      method: "POST",
      url: "/internal/commands",
      headers: authHeader,
      payload: tampered,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /internal/commands acceptance", () => {
  it("accepts a valid signed command, stores it, and returns 202", async () => {
    const { app, store } = await makeGateway();
    const command = makeCommand();
    const res = await app.inject({
      method: "POST",
      url: "/internal/commands",
      headers: authHeader,
      payload: command,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ commandId: command.commandId, status: "created" });
    const stored = await store.getCommand(command.commandId);
    expect(stored).toBeDefined();
    // no device connected + 1 attempt → dispatcher marks it failed shortly after
    await new Promise((r) => setTimeout(r, 20));
    expect((await store.getCommand(command.commandId))?.status).toBe("failed");
  });

  it("dedupes resubmissions by idempotency key", async () => {
    const { app } = await makeGateway();
    const command = makeCommand();
    const first = await app.inject({
      method: "POST",
      url: "/internal/commands",
      headers: authHeader,
      payload: command,
    });
    expect(first.statusCode).toBe(202);
    const second = await app.inject({
      method: "POST",
      url: "/internal/commands",
      headers: authHeader,
      payload: command,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ commandId: command.commandId, deduplicated: true });
  });

  it("marks an expired command expired without sending", async () => {
    const { app, store } = await makeGateway();
    const command = makeCommand({ expiresAt: new Date(Date.now() - 5_000).toISOString() });
    const res = await app.inject({
      method: "POST",
      url: "/internal/commands",
      headers: authHeader,
      payload: command,
    });
    expect(res.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 20));
    const stored = await store.getCommand(command.commandId);
    expect(stored?.status).toBe("expired");
    expect(stored?.attempts).toBe(0);
  });
});
