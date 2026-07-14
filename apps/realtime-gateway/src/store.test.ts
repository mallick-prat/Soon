import { describe, expect, it } from "vitest";
import { InMemoryCommandStore, InMemoryEventSink } from "./store.js";
import { handleDeviceEvent } from "./device-events.js";
import { makeCommand, makeDeviceEvent, silentLogger } from "./test-helpers.js";

describe("InMemoryCommandStore commands", () => {
  it("saves commands as created and tracks status transitions", async () => {
    const store = new InMemoryCommandStore();
    const command = makeCommand();
    await store.saveCommand(command);
    expect((await store.getCommand(command.commandId))?.status).toBe("created");
    await store.setCommandStatus(command.commandId, "dispatched");
    await store.setCommandStatus(command.commandId, "delivered");
    await store.setCommandStatus(command.commandId, "acknowledged");
    expect((await store.getCommand(command.commandId))?.status).toBe("acknowledged");
  });

  it("rejects duplicate commandIds and finds commands by idempotency key", async () => {
    const store = new InMemoryCommandStore();
    const command = makeCommand();
    await store.saveCommand(command);
    await expect(store.saveCommand(command)).rejects.toThrow(/already exists/);
    const found = await store.findCommandByIdempotencyKey(command.idempotencyKey);
    expect(found?.command.commandId).toBe(command.commandId);
    expect(await store.findCommandByIdempotencyKey("nope")).toBeUndefined();
  });

  it("counts dispatch attempts", async () => {
    const store = new InMemoryCommandStore();
    const command = makeCommand();
    await store.saveCommand(command);
    expect(await store.recordDispatchAttempt(command.commandId)).toBe(1);
    expect(await store.recordDispatchAttempt(command.commandId)).toBe(2);
  });
});

describe("InMemoryCommandStore device events", () => {
  it("accepts strictly increasing sequence numbers", async () => {
    const store = new InMemoryCommandStore();
    expect(
      await store.registerDeviceEvent({ deviceId: "d1", sequenceNumber: 1, idempotencyKey: "a" }),
    ).toBe("accepted");
    expect(
      await store.registerDeviceEvent({ deviceId: "d1", sequenceNumber: 5, idempotencyKey: "b" }),
    ).toBe("accepted");
    expect(await store.lastEventSequence("d1")).toBe(5);
  });

  it("rejects stale (equal or lower) sequence numbers", async () => {
    const store = new InMemoryCommandStore();
    await store.registerDeviceEvent({ deviceId: "d1", sequenceNumber: 5, idempotencyKey: "a" });
    expect(
      await store.registerDeviceEvent({ deviceId: "d1", sequenceNumber: 5, idempotencyKey: "b" }),
    ).toBe("stale");
    expect(
      await store.registerDeviceEvent({ deviceId: "d1", sequenceNumber: 4, idempotencyKey: "c" }),
    ).toBe("stale");
  });

  it("dedupes by idempotency key even when the sequence is stale", async () => {
    const store = new InMemoryCommandStore();
    await store.registerDeviceEvent({ deviceId: "d1", sequenceNumber: 3, idempotencyKey: "a" });
    // retransmit of the same event: same key, now-stale sequence → duplicate, not stale
    expect(
      await store.registerDeviceEvent({ deviceId: "d1", sequenceNumber: 3, idempotencyKey: "a" }),
    ).toBe("duplicate");
  });

  it("tracks sequences and idempotency per device independently", async () => {
    const store = new InMemoryCommandStore();
    await store.registerDeviceEvent({ deviceId: "d1", sequenceNumber: 9, idempotencyKey: "a" });
    expect(
      await store.registerDeviceEvent({ deviceId: "d2", sequenceNumber: 1, idempotencyKey: "a" }),
    ).toBe("accepted");
    expect(await store.lastEventSequence("d2")).toBe(1);
    expect(await store.lastEventSequence("d3")).toBeUndefined();
  });
});

describe("handleDeviceEvent", () => {
  function setup() {
    const store = new InMemoryCommandStore();
    const sink = new InMemoryEventSink();
    const deps = { store, sink, logger: silentLogger(), authenticatedDeviceId: "device-1" };
    return { store, sink, deps };
  }

  it("acks and forwards a valid event", async () => {
    const { sink, deps } = setup();
    const event = makeDeviceEvent();
    const ack = await handleDeviceEvent(event, deps);
    expect(ack).toEqual({ ok: true, id: event.eventId });
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]?.eventId).toBe(event.eventId);
  });

  it("rejects schema-invalid events", async () => {
    const { sink, deps } = setup();
    const ack = await handleDeviceEvent({ eventId: "e-bad", type: "nope" }, deps);
    expect(ack.ok).toBe(false);
    expect(ack.errorCode).toBe("invalid_event");
    expect(ack.id).toBe("e-bad");
    expect(sink.events).toHaveLength(0);
  });

  it("rejects events whose deviceId does not match the socket jwt", async () => {
    const { sink, deps } = setup();
    const event = makeDeviceEvent({ deviceId: "device-9" });
    const ack = await handleDeviceEvent(event, deps);
    expect(ack.ok).toBe(false);
    expect(ack.errorCode).toBe("device_mismatch");
    expect(sink.events).toHaveLength(0);
  });

  it("acks duplicates ok without re-forwarding", async () => {
    const { sink, deps } = setup();
    const event = makeDeviceEvent();
    await handleDeviceEvent(event, deps);
    const ack = await handleDeviceEvent(event, deps);
    expect(ack.ok).toBe(true);
    expect(sink.events).toHaveLength(1);
  });

  it("rejects stale sequences with an error ack", async () => {
    const { sink, deps } = setup();
    await handleDeviceEvent(makeDeviceEvent({ sequenceNumber: 10 }), deps);
    const ack = await handleDeviceEvent(makeDeviceEvent({ sequenceNumber: 4 }), deps);
    expect(ack.ok).toBe(false);
    expect(ack.errorCode).toBe("stale_sequence");
    expect(sink.events).toHaveLength(1);
  });

  it("reports sink failures without crashing", async () => {
    const { deps } = setup();
    const failing = {
      handleDeviceEvent: async () => {
        throw new Error("downstream unavailable");
      },
    };
    const ack = await handleDeviceEvent(makeDeviceEvent(), { ...deps, sink: failing });
    expect(ack.ok).toBe(false);
    expect(ack.errorCode).toBe("sink_error");
  });
});
