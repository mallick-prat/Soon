/**
 * production CommandDispatcher — persists commands to the outbox_commands
 * table (@soon/database). the gateway's outbox drainer signs each row into a
 * CloudCommand envelope and delivers it to the device socket; per the port
 * contract this adapter resolves when the command is *persisted*, not
 * delivered.
 *
 * every payload is validated against the realtime protocol schema before it
 * is written, so a malformed command can never reach the mac.
 */
import { enqueueOutboxCommand } from "@soon/database";
import {
  requestApprovalPayloadSchema,
  sendMessagePayloadSchema,
  showNotificationPayloadSchema,
} from "@soon/realtime-protocol";

import type { CommandDispatcher } from "../ports.js";

type EnqueueFn = typeof enqueueOutboxCommand;

/**
 * @param enqueue injectable outbox writer (defaults to the real prisma repo);
 *   tests pass a spy to assert the persisted command without a database.
 */
export function createGatewayDispatcher(enqueue: EnqueueFn = enqueueOutboxCommand): CommandDispatcher {
  return {
    async enqueueSend(input) {
      const payload = sendMessagePayloadSchema.parse({
        conversationReference: input.conversationReference,
        text: input.text,
        draftId: input.draftId,
        approvalSource: input.approvalSource,
      });
      const row = await enqueue({
        userId: input.userId,
        sessionId: input.sessionId,
        commandType: "send_message",
        payloadJson: payload,
        idempotencyKey: input.idempotencyKey,
        expiresAt: new Date(input.expiresAtIso),
      });
      return { commandId: row.id };
    },

    async enqueueApprovalRequest(input) {
      const payload = requestApprovalPayloadSchema.parse({
        draftId: input.draftId,
        conversationReference: input.conversationReference,
        proposedText: input.text,
        meetingContext: input.meetingContext,
        candidateTimes: input.candidateTimes,
        whySelected: input.whySelected,
        bundleStatus: input.bundleStatus,
        expiresAt: input.expiresAtIso,
      });
      const row = await enqueue({
        userId: input.userId,
        sessionId: input.sessionId,
        commandType: "request_approval",
        payloadJson: payload,
        idempotencyKey: input.idempotencyKey,
        expiresAt: new Date(input.expiresAtIso),
      });
      return { commandId: row.id };
    },

    async notify(userId, title, subtext, actions) {
      const payload = showNotificationPayloadSchema.parse({
        title,
        ...(subtext !== undefined ? { subtext } : {}),
        actions: actions ?? [],
      });
      await enqueue({
        userId,
        commandType: "show_notification",
        payloadJson: payload,
        // identical notifications collapse; distinct titles stay distinct.
        idempotencyKey: `notify:${userId}:${title}`,
      });
    },
  };
}
