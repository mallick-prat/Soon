import { describe, expect, it } from "vitest";
import { SOCKET_EVENTS, type Ack } from "@soon/realtime-protocol";
import { createCommandDispatcher, type DeviceSocketLike } from "./dispatch.js";
import { withBackoff, AbortRetryError } from "./retry.js";
import { InMemoryCommandStore } from "./store.js";
import { makeCommand, silentLogger } from "./test-helpers.js";

const instantSleep = async () => {};

function fakeSocket(respond: (payload: unknown) => Promise<unknown>) {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const socket: DeviceSocketLike = {
    timeout: () => ({
      emitWithAck: async (event, payload) => {
        emitted.push({ event, payload });
        return respond(payload);
      },
    }),
  };
  return { socket, emitted };
}

function okAck(payload: unknown): Ack {
  return { ok: true, id: (payload as { commandId: string }).commandId };
}

describe("withBackoff", () => {
  it("retries with exponential delays and succeeds", async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await withBackoff(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("transient");
        return "done";
      },
      { attempts: 4, baseDelayMs: 100, sleep: instantSleep, onRetry: (_e, _a, d) => delays.push(d) },
    );
    expect(result).toBe("done");
    expect(calls).toBe(3);
    expect(delays).toEqual([100, 200]);
  });

  it("stops immediately when shouldRetry returns false", async () => {
    let calls = 0;
    await expect(
      withBackoff(
        async () => {
          calls += 1;
          throw new AbortRetryError("fatal", "fatal");
        },
        {
          attempts: 5,
          sleep: instantSleep,
          shouldRetry: (e) => !(e instanceof AbortRetryError),
        },
      ),
    ).rejects.toThrow("fatal");
    expect(calls).toBe(1);
  });

  it("throws the last error after exhausting attempts", async () => {
    let calls = 0;
    await expect(
      withBackoff(
        async () => {
          calls += 1;
          throw new Error(`attempt ${calls}`);
        },
        { attempts: 3, sleep: instantSleep },
      ),
    ).rejects.toThrow("attempt 3");
    expect(calls).toBe(3);
  });
});

describe("command dispatcher", () => {
  function setup(options: {
    socket?: DeviceSocketLike | undefined;
    now?: () => Date;
    attempts?: number;
  }) {
    const store = new InMemoryCommandStore();
    const dispatcher = createCommandDispatcher({
      store,
      logger: silentLogger(),
      getSocket: () => options.socket,
      attempts: options.attempts ?? 3,
      baseDelayMs: 1,
      sleep: instantSleep,
      ...(options.now ? { now: options.now } : {}),
    });
    return { store, dispatcher };
  }

  it("walks the lifecycle created → dispatched → delivered → acknowledged", async () => {
    const { socket, emitted } = fakeSocket(async (p) => okAck(p));
    const { store, dispatcher } = setup({ socket });
    const command = makeCommand();
    await store.saveCommand(command);
    await dispatcher.dispatch(command);
    const stored = await store.getCommand(command.commandId);
    expect(stored?.status).toBe("acknowledged");
    expect(stored?.attempts).toBe(1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.event).toBe(SOCKET_EVENTS.command);
  });

  it("never sends an already-expired command and marks it expired", async () => {
    const { socket, emitted } = fakeSocket(async (p) => okAck(p));
    const { store, dispatcher } = setup({ socket });
    const command = makeCommand({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    await store.saveCommand(command);
    await dispatcher.dispatch(command);
    const stored = await store.getCommand(command.commandId);
    expect(stored?.status).toBe("expired");
    expect(stored?.attempts).toBe(0);
    expect(emitted).toHaveLength(0);
  });

  it("checks expiry before every retry attempt", async () => {
    let nowMs = Date.parse("2026-07-14T00:00:00Z");
    const command = makeCommand({
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 1_000).toISOString(),
    });
    // socket that always times out; clock jumps past expiry after first attempt
    const { socket, emitted } = fakeSocket(async () => {
      nowMs += 10_000;
      throw new Error("ack timeout");
    });
    const { store, dispatcher } = setup({ socket, now: () => new Date(nowMs), attempts: 5 });
    await store.saveCommand(command);
    await dispatcher.dispatch(command);
    expect(emitted).toHaveLength(1);
    expect((await store.getCommand(command.commandId))?.status).toBe("expired");
  });

  it("retries when the device is offline and fails after exhausting attempts", async () => {
    const { store, dispatcher } = setup({ socket: undefined, attempts: 3 });
    const command = makeCommand();
    await store.saveCommand(command);
    await dispatcher.dispatch(command);
    const stored = await store.getCommand(command.commandId);
    expect(stored?.status).toBe("failed");
    expect(stored?.lastErrorCode).toBe("dispatch_exhausted");
  });

  it("retries transient ack timeouts then marks delivered+acknowledged on success", async () => {
    let attempts = 0;
    const { socket } = fakeSocket(async (p) => {
      attempts += 1;
      if (attempts < 3) throw new Error("operation has timed out");
      return okAck(p);
    });
    const { store, dispatcher } = setup({ socket, attempts: 3 });
    const command = makeCommand();
    await store.saveCommand(command);
    await dispatcher.dispatch(command);
    const stored = await store.getCommand(command.commandId);
    expect(stored?.status).toBe("acknowledged");
    expect(stored?.attempts).toBe(3);
  });

  it("marks failed without retrying when the device rejects the command", async () => {
    const { socket, emitted } = fakeSocket(async (p) => ({
      ok: false,
      id: (p as { commandId: string }).commandId,
      errorCode: "unsupported_command",
    }));
    const { store, dispatcher } = setup({ socket, attempts: 5 });
    const command = makeCommand();
    await store.saveCommand(command);
    await dispatcher.dispatch(command);
    const stored = await store.getCommand(command.commandId);
    expect(stored?.status).toBe("failed");
    expect(stored?.lastErrorCode).toBe("unsupported_command");
    expect(emitted).toHaveLength(1);
  });

  it("treats malformed acks as retryable failures", async () => {
    const { socket } = fakeSocket(async () => ({ nonsense: true }));
    const { store, dispatcher } = setup({ socket, attempts: 2 });
    const command = makeCommand();
    await store.saveCommand(command);
    await dispatcher.dispatch(command);
    const stored = await store.getCommand(command.commandId);
    expect(stored?.status).toBe("failed");
    expect(stored?.attempts).toBe(2);
  });
});
