import { describe, expect, it } from "vitest";
import type { OutboxCommand } from "@soon/database";
import {
  cloudCommandSchema,
  requestApprovalPayloadSchema,
  sendMessagePayloadSchema,
} from "@soon/realtime-protocol";

import { createGatewayDispatcher } from "./gateway-dispatcher.js";

type EnqueueCall = { commandType: string; payloadJson: unknown; idempotencyKey: string; sessionId?: string };

const spyEnqueue = () => {
  const calls: EnqueueCall[] = [];
  const enqueue = (async (input: {
    commandType: string;
    payloadJson: unknown;
    idempotencyKey: string;
    sessionId?: string;
  }) => {
    calls.push({
      commandType: input.commandType,
      payloadJson: input.payloadJson,
      idempotencyKey: input.idempotencyKey,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    });
    return { id: `row-${calls.length}` } as unknown as OutboxCommand;
  }) as unknown as typeof import("@soon/database").enqueueOutboxCommand;
  return { calls, enqueue };
};

describe("createGatewayDispatcher", () => {
  it("persists a protocol-valid request_approval command", async () => {
    const { calls, enqueue } = spyEnqueue();
    const dispatcher = createGatewayDispatcher(enqueue);

    const { commandId } = await dispatcher.enqueueApprovalRequest({
      userId: "user-1",
      sessionId: "session-1",
      conversationReference: "conv-ref",
      draftId: "draft-1",
      text: "how's tues around 3 or thurs morning?",
      meetingContext: "coffee",
      candidateTimes: [{ slotId: "s1", label: "tuesday at 3:00pm" }],
      whySelected: "",
      bundleStatus: { mode: "approve_every" },
      idempotencyKey: "approve:draft-1",
      expiresAtIso: "2026-07-18T00:00:00.000Z",
    });

    expect(commandId).toBe("row-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.commandType).toBe("request_approval");
    expect(calls[0]!.idempotencyKey).toBe("approve:draft-1");

    // the persisted payload is exactly what the mac's schema will accept.
    const payload = requestApprovalPayloadSchema.parse(calls[0]!.payloadJson);
    expect(payload.proposedText).toBe("how's tues around 3 or thurs morning?");
    expect(payload.candidateTimes).toHaveLength(1);
    expect(payload.bundleStatus).toEqual({ mode: "approve_every" });

    // and a full cloud command built from it validates end-to-end.
    const command = {
      protocolVersion: 1,
      commandId: "cmd-1",
      deviceId: "dev-1",
      sessionId: "session-1",
      sequenceNumber: 1,
      issuedAt: "2026-07-17T00:00:00.000Z",
      expiresAt: "2026-07-18T00:00:00.000Z",
      idempotencyKey: "approve:draft-1",
      signature: "sig",
      type: "request_approval",
      payload,
    };
    expect(cloudCommandSchema.safeParse(command).success).toBe(true);
  });

  it("persists a protocol-valid send_message command", async () => {
    const { calls, enqueue } = spyEnqueue();
    const dispatcher = createGatewayDispatcher(enqueue);

    await dispatcher.enqueueSend({
      userId: "user-1",
      sessionId: "session-1",
      conversationReference: "conv-ref",
      draftId: "draft-1",
      text: "perfect, just sent it",
      approvalSource: "explicit",
      idempotencyKey: "send:draft-1",
      expiresAtIso: "2026-07-18T00:00:00.000Z",
    });

    expect(calls[0]!.commandType).toBe("send_message");
    const payload = sendMessagePayloadSchema.parse(calls[0]!.payloadJson);
    expect(payload.approvalSource).toBe("explicit");
    expect(payload.text).toBe("perfect, just sent it");
  });

  it("dedupes identical notifications by title", async () => {
    const { calls, enqueue } = spyEnqueue();
    const dispatcher = createGatewayDispatcher(enqueue);
    await dispatcher.notify("user-1", "soon is on it", "watching this one", ["review", "stop"]);
    expect(calls[0]!.commandType).toBe("show_notification");
    expect(calls[0]!.idempotencyKey).toBe("notify:user-1:soon is on it");
  });
});
