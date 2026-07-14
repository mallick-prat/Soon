import { describe, expect, it, vi } from "vitest";
import type { OutboxCommand } from "@soon/database";
import { cloudCommandSchema } from "@soon/realtime-protocol";
import { verifyEnvelopeSignature } from "@soon/security";

import { createOutboxDrainer, type OutboxStatusUpdate } from "./outbox-drainer.js";

const SECRET = "device-signing-secret-at-least-16-chars";

const row = (overrides: Partial<OutboxCommand> = {}): OutboxCommand =>
  ({
    id: "cmd-1",
    userId: "user-1",
    deviceId: "device-1",
    sessionId: "session-1",
    commandType: "send_message",
    payloadJson: {
      conversationReference: "conv-1",
      text: "how's tues at 3?",
      draftId: "draft-1",
      approvalSource: "explicit",
    },
    idempotencyKey: "send:draft-1",
    sequenceNumber: 7n,
    status: "pending",
    expiresAt: new Date("2026-07-18T00:00:00.000Z"),
    ...overrides,
  }) as unknown as OutboxCommand;

const harness = (
  rows: OutboxCommand[],
  post: (url: string, token: string, body: unknown) => Promise<{ status: number }>,
) => {
  const advanced: Array<{ key: string; status: OutboxStatusUpdate; errorCode?: string }> = [];
  const posted: unknown[] = [];
  const drainer = createOutboxDrainer({
    gatewayUrl: "https://gateway.test",
    internalToken: "internal-token",
    signingSecret: SECRET,
    now: () => new Date("2026-07-17T12:00:00.000Z"),
    fetchPending: async () => rows,
    resolveDeviceId: async (r) => r.deviceId,
    advanceStatus: async (key, status, errorCode) => {
      advanced.push({ key, status, ...(errorCode !== undefined ? { errorCode } : {}) });
    },
    post: async (url, token, body) => {
      posted.push({ url, token, body });
      return post(url, token, body);
    },
  });
  return { drainer, advanced, posted };
};

describe("createOutboxDrainer", () => {
  it("posts a valid, correctly-signed CloudCommand and marks it dispatched", async () => {
    const h = harness([row()], async () => ({ status: 202 }));
    const result = await h.drainer.drainOnce();

    expect(result).toEqual({ dispatched: 1, failed: 0, skipped: 0 });
    expect(h.advanced).toEqual([{ key: "send:draft-1", status: "dispatched" }]);

    const sent = h.posted[0] as { url: string; token: string; body: Record<string, unknown> };
    expect(sent.url).toBe("https://gateway.test/internal/commands");
    expect(sent.token).toBe("internal-token");
    // the gateway will accept this: schema-valid and signature verifies.
    expect(cloudCommandSchema.safeParse(sent.body).success).toBe(true);
    expect(verifyEnvelopeSignature(sent.body, SECRET)).toBe(true);
    expect(sent.body.deviceId).toBe("device-1");
    expect(sent.body.commandId).toBe("cmd-1");
  });

  it("re-signing survives the gateway's own re-parse (signature stable through parse)", async () => {
    const h = harness([row({ commandType: "request_approval", payloadJson: {
      draftId: "draft-1",
      conversationReference: "conv-1",
      proposedText: "how's tues at 3 or thurs am?",
      meetingContext: "coffee",
      candidateTimes: [{ slotId: "s1", label: "tuesday at 3:00pm" }],
      whySelected: "",
      bundleStatus: { mode: "approve_every" },
      expiresAt: "2026-07-18T00:00:00.000Z",
    } })], async () => ({ status: 202 }));
    await h.drainer.drainOnce();
    const sent = h.posted[0] as { body: Record<string, unknown> };
    // re-parse (as the gateway does) then verify — must still hold.
    const reparsed = cloudCommandSchema.parse(sent.body);
    expect(verifyEnvelopeSignature(reparsed as unknown as Record<string, unknown>, SECRET)).toBe(true);
  });

  it("marks a command failed when the gateway rejects it", async () => {
    const h = harness([row()], async () => ({ status: 403 }));
    const result = await h.drainer.drainOnce();
    expect(result).toEqual({ dispatched: 0, failed: 1, skipped: 0 });
    expect(h.advanced).toEqual([{ key: "send:draft-1", status: "failed", errorCode: "gateway_403" }]);
  });

  it("leaves the row pending on a transient network error", async () => {
    const h = harness([row()], async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await h.drainer.drainOnce();
    expect(result).toEqual({ dispatched: 0, failed: 1, skipped: 0 });
    expect(h.advanced).toEqual([]); // NOT advanced — stays pending for retry
  });

  it("fails an undispatchable row with no target device", async () => {
    const drainer = createOutboxDrainer({
      gatewayUrl: "https://gateway.test",
      internalToken: "t",
      signingSecret: SECRET,
      fetchPending: async () => [row({ deviceId: null })],
      resolveDeviceId: async () => null,
      advanceStatus: async () => {},
      post: async () => {
        throw new Error("should not POST an undispatchable row");
      },
    });
    const result = await drainer.drainOnce();
    expect(result).toEqual({ dispatched: 0, failed: 0, skipped: 1 });
  });

  it("skips a row whose payload does not match its command type", async () => {
    const postSpy = vi.fn(async () => ({ status: 202 }));
    const h = harness([row({ commandType: "send_message", payloadJson: { nonsense: true } })], postSpy);
    const result = await h.drainer.drainOnce();
    expect(result).toEqual({ dispatched: 0, failed: 0, skipped: 1 });
    expect(postSpy).not.toHaveBeenCalled();
    expect(h.advanced).toEqual([{ key: "send:draft-1", status: "failed", errorCode: "undispatchable" }]);
  });
});
