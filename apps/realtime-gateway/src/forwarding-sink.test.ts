import { describe, expect, it, vi } from "vitest";

import type { DeviceEvent } from "@soon/realtime-protocol";

import { createForwardingEventSink } from "./forwarding-sink.js";

function event(): DeviceEvent {
  return {
    protocolVersion: 1,
    eventId: "evt-1",
    deviceId: "dev-1",
    sequenceNumber: 1,
    occurredAt: new Date().toISOString(),
    idempotencyKey: "idem-1",
    type: "context_collected",
    payload: { context: {} },
  } as unknown as DeviceEvent;
}

describe("createForwardingEventSink", () => {
  it("POSTs the event to the worker with the bearer token", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const sink = createForwardingEventSink({
      url: "http://worker.test/internal/device-events",
      internalToken: "secret-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await sink.handleDeviceEvent(event());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://worker.test/internal/device-events");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret-token");
    expect(JSON.parse(init.body as string).type).toBe("context_collected");
  });

  it("swallows a failing worker so the gateway path never wedges", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const warn = vi.fn();
    const sink = createForwardingEventSink({
      url: "http://worker.test/internal/device-events",
      internalToken: "secret-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    });

    await expect(sink.handleDeviceEvent(event())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("logs a non-ok worker response without throwing", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const warn = vi.fn();
    const sink = createForwardingEventSink({
      url: "http://worker.test/internal/device-events",
      internalToken: "secret-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    });

    await sink.handleDeviceEvent(event());
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
