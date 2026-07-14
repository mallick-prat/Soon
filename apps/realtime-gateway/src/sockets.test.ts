/**
 * socket integration tests. socket.io-client is not a dependency of this app,
 * but it is installed for apps/mac in the same workspace — we resolve it from
 * there via createRequire, which works under pnpm's isolated node_modules.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { mintDeviceJwt } from "@soon/security";
import { SOCKET_EVENTS, type Ack, type CloudCommand } from "@soon/realtime-protocol";
import { buildApp, type Gateway } from "./app.js";
import { InMemoryEventSink } from "./store.js";
import {
  TEST_INTERNAL_TOKEN,
  TEST_JWT_SECRET,
  makeCommand,
  makeDeviceEvent,
  silentLogger,
  testConfig,
} from "./test-helpers.js";

const requireFromMac = createRequire(
  new URL("../../mac/package.json", import.meta.url),
);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const { io: ioc } = requireFromMac("socket.io-client") as {
  io: (url: string, opts?: Record<string, unknown>) => ClientSocket;
};

interface ClientSocket {
  on(event: string, handler: (...args: never[]) => void): void;
  once(event: string, handler: (...args: never[]) => void): void;
  emit(event: string, payload: unknown, ack?: (response: unknown) => void): void;
  emitWithAck?(event: string, payload: unknown): Promise<unknown>;
  disconnect(): void;
  connected: boolean;
  id?: string;
}

let gateway: Gateway | undefined;
const clients: ClientSocket[] = [];

async function startGateway(): Promise<{ url: string; gateway: Gateway; sink: InMemoryEventSink }> {
  const sink = new InMemoryEventSink();
  gateway = await buildApp({
    config: testConfig(),
    logger: silentLogger(),
    sink,
    dispatch: { attempts: 2, baseDelayMs: 5, ackTimeoutMs: 1_000 },
  });
  await gateway.app.listen({ port: 0, host: "127.0.0.1" });
  const address = gateway.app.server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, gateway, sink };
}

function connect(url: string, token: string | undefined): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioc(url, {
      transports: ["websocket"],
      reconnection: false,
      ...(token !== undefined ? { auth: { token } } : {}),
    });
    clients.push(socket);
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", ((error: Error) => reject(error)) as never);
  });
}

async function deviceToken(deviceId = "device-1"): Promise<string> {
  return mintDeviceJwt({ deviceId, userId: "user-1", secret: TEST_JWT_SECRET });
}

function emitEvent(socket: ClientSocket, payload: unknown): Promise<Ack> {
  return new Promise((resolve) => {
    socket.emit(SOCKET_EVENTS.deviceEvent, payload, (response) => resolve(response as Ack));
  });
}

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> => {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
};

afterEach(async () => {
  for (const client of clients.splice(0)) {
    try {
      client.disconnect();
    } catch {
      // already closed
    }
  }
  await gateway?.app.close();
  gateway = undefined;
});

describe("socket auth middleware", () => {
  it("rejects connections without a token", async () => {
    const { url } = await startGateway();
    await expect(connect(url, undefined)).rejects.toThrow();
  });

  it("rejects connections with an invalid token", async () => {
    const { url } = await startGateway();
    await expect(connect(url, "garbage.token.value")).rejects.toThrow();
  });

  it("accepts a valid device jwt and counts the device in /health", async () => {
    const { url, gateway } = await startGateway();
    await connect(url, await deviceToken());
    await waitFor(() => gateway.registry.count() === 1);
    const res = await gateway.app.inject({ method: "GET", url: "/health" });
    expect(res.json().connectedDevices).toBe(1);
  });

  it("enforces one active socket per device by disconnecting the older one", async () => {
    const { url, gateway } = await startGateway();
    const first = await connect(url, await deviceToken("device-1"));
    const second = await connect(url, await deviceToken("device-1"));
    await waitFor(() => !first.connected);
    expect(second.connected).toBe(true);
    expect(gateway.registry.count()).toBe(1);
    expect(gateway.registry.get("device-1")?.id).toBe(second.id);
  });
});

describe("inbound device events over the socket", () => {
  it("validates, forwards, and acks a device event", async () => {
    const { url, sink } = await startGateway();
    const socket = await connect(url, await deviceToken());
    const event = makeDeviceEvent();
    const ack = await emitEvent(socket, event);
    expect(ack).toEqual({ ok: true, id: event.eventId });
    expect(sink.events.map((e) => e.eventId)).toContain(event.eventId);
  });

  it("rejects stale sequences and dedupes retransmits over the wire", async () => {
    const { url, sink } = await startGateway();
    const socket = await connect(url, await deviceToken());
    const event = makeDeviceEvent({ sequenceNumber: 100 });
    expect((await emitEvent(socket, event)).ok).toBe(true);
    // retransmit: duplicate → ok, not forwarded twice
    expect((await emitEvent(socket, event)).ok).toBe(true);
    expect(sink.events.filter((e) => e.eventId === event.eventId)).toHaveLength(1);
    // lower sequence with a fresh key → stale
    const stale = await emitEvent(socket, makeDeviceEvent({ sequenceNumber: 50 }));
    expect(stale.ok).toBe(false);
    expect(stale.errorCode).toBe("stale_sequence");
  });

  it("rejects events for a different deviceId than the jwt", async () => {
    const { url } = await startGateway();
    const socket = await connect(url, await deviceToken("device-1"));
    const ack = await emitEvent(socket, makeDeviceEvent({ deviceId: "device-2" }));
    expect(ack.ok).toBe(false);
    expect(ack.errorCode).toBe("device_mismatch");
  });
});

describe("end-to-end command dispatch", () => {
  it("delivers an internal command to the connected device and marks it acknowledged", async () => {
    const { url, gateway } = await startGateway();
    const socket = await connect(url, await deviceToken("device-1"));
    const received: CloudCommand[] = [];
    socket.on(SOCKET_EVENTS.command, ((command: CloudCommand, ack: (a: Ack) => void) => {
      received.push(command);
      ack({ ok: true, id: command.commandId });
    }) as never);

    const command = makeCommand({ deviceId: "device-1" });
    const res = await gateway.app.inject({
      method: "POST",
      url: "/internal/commands",
      headers: { authorization: `Bearer ${TEST_INTERNAL_TOKEN}` },
      payload: command,
    });
    expect(res.statusCode).toBe(202);

    await waitFor(() => received.length === 1);
    expect(received[0]?.commandId).toBe(command.commandId);
    await waitFor(
      async () => (await gateway!.store.getCommand(command.commandId))?.status === "acknowledged",
    );
    const stored = await gateway.store.getCommand(command.commandId);
    expect(stored?.status).toBe("acknowledged");
  });

  it("marks the command failed when the device rejects it", async () => {
    const { url, gateway } = await startGateway();
    const socket = await connect(url, await deviceToken("device-1"));
    socket.on(SOCKET_EVENTS.command, ((command: CloudCommand, ack: (a: Ack) => void) => {
      ack({ ok: false, id: command.commandId, errorCode: "busy" });
    }) as never);

    const command = makeCommand({ deviceId: "device-1" });
    await gateway.app.inject({
      method: "POST",
      url: "/internal/commands",
      headers: { authorization: `Bearer ${TEST_INTERNAL_TOKEN}` },
      payload: command,
    });
    await waitFor(
      async () => (await gateway!.store.getCommand(command.commandId))?.status === "failed",
    );
    const stored = await gateway.store.getCommand(command.commandId);
    expect(stored?.status).toBe("failed");
    expect(stored?.lastErrorCode).toBe("busy");
  });
});
