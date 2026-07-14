import { z } from "zod";

export const PROTOCOL_VERSION = 1;

/** commands the cloud sends to the mac companion */
export const commandTypeSchema = z.enum([
  "send_message",
  "request_approval",
  "collect_context",
  "show_notification",
  "cancel_command",
  "ping",
]);
export type CommandType = z.infer<typeof commandTypeSchema>;

/** events the mac companion sends to the cloud */
export const deviceEventTypeSchema = z.enum([
  "trigger_detected",
  "context_collected",
  "inbound_message",
  "message_sent",
  "send_failed",
  "command_expired",
  "approval_decision",
  "health",
]);
export type DeviceEventType = z.infer<typeof deviceEventTypeSchema>;

const envelopeBase = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commandId: z.string(),
  deviceId: z.string(),
  sessionId: z.string().optional(),
  sequenceNumber: z.number().int().nonnegative(),
  /** ISO instants */
  issuedAt: z.string(),
  expiresAt: z.string(),
  idempotencyKey: z.string(),
  /** base64url HMAC over the canonical payload */
  signature: z.string(),
};

export const sendMessagePayloadSchema = z.object({
  conversationReference: z.string(),
  text: z.string().min(1).max(2000),
  draftId: z.string(),
  approvalSource: z.enum(["explicit", "bundle"]),
});
export type SendMessagePayload = z.infer<typeof sendMessagePayloadSchema>;

/** a candidate meeting time, pre-formatted for display in the approval window */
export const candidateTimeSchema = z.object({
  slotId: z.string(),
  label: z.string(),
});
export type CandidateTime = z.infer<typeof candidateTimeSchema>;

/** the approval mode in effect for a draft, shown in the approval window */
export const bundleStatusSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("approve_every") }),
  z.object({
    mode: z.literal("bundle"),
    messagesUsed: z.number().int().nonnegative(),
    maximumOutboundMessages: z.number().int().positive(),
    expiresAt: z.string(),
  }),
  z.object({ mode: z.literal("calendar_only") }),
]);
export type BundleStatus = z.infer<typeof bundleStatusSchema>;

/**
 * ask the mac to show its private approval window for a proposed message.
 * carries the full draft so the window renders real content (never a stub).
 * the user's choice comes back as an `approval_decision` device event — the
 * cloud, not the mac, then issues the actual `send_message` command.
 */
export const requestApprovalPayloadSchema = z.object({
  draftId: z.string(),
  conversationReference: z.string(),
  proposedText: z.string().min(1).max(2000),
  meetingContext: z.string().default(""),
  candidateTimes: z.array(candidateTimeSchema).max(5).default([]),
  whySelected: z.string().default(""),
  bundleStatus: bundleStatusSchema,
  /** ISO instant after which this draft must not be sent */
  expiresAt: z.string(),
});
export type RequestApprovalPayload = z.infer<typeof requestApprovalPayloadSchema>;

export const collectContextPayloadSchema = z.object({
  conversationReference: z.string(),
  maxMessages: z.number().int().positive().max(20),
  maxAgeHours: z.number().int().positive().max(48),
});
export type CollectContextPayload = z.infer<typeof collectContextPayloadSchema>;

export const showNotificationPayloadSchema = z.object({
  title: z.string(),
  subtext: z.string().optional(),
  actions: z.array(z.string()).max(3).default([]),
  draftId: z.string().optional(),
});
export type ShowNotificationPayload = z.infer<typeof showNotificationPayloadSchema>;

export const cancelCommandPayloadSchema = z.object({
  targetCommandId: z.string(),
});

export const cloudCommandSchema = z.discriminatedUnion("type", [
  z.object({ ...envelopeBase, type: z.literal("send_message"), payload: sendMessagePayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("request_approval"), payload: requestApprovalPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("collect_context"), payload: collectContextPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("show_notification"), payload: showNotificationPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("cancel_command"), payload: cancelCommandPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("ping"), payload: z.object({}) }),
]);
export type CloudCommand = z.infer<typeof cloudCommandSchema>;

const deviceEventBase = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  eventId: z.string(),
  deviceId: z.string(),
  sessionId: z.string().optional(),
  sequenceNumber: z.number().int().nonnegative(),
  occurredAt: z.string(),
  idempotencyKey: z.string(),
};

export const deviceEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...deviceEventBase,
    type: z.literal("trigger_detected"),
    payload: z.object({
      conversationReference: z.string(),
      triggerMessageReference: z.string(),
      triggerText: z.string(),
      sentAt: z.string(),
      isGroup: z.boolean(),
      participantCount: z.number().int().positive(),
    }),
  }),
  z.object({
    ...deviceEventBase,
    type: z.literal("context_collected"),
    payload: z.object({
      conversationReference: z.string(),
      /** ActivationContext from @soon/shared-types, re-validated server-side */
      context: z.unknown(),
      inResponseToCommandId: z.string().optional(),
    }),
  }),
  z.object({
    ...deviceEventBase,
    type: z.literal("inbound_message"),
    payload: z.object({
      conversationReference: z.string(),
      localMessageReference: z.string(),
      text: z.string(),
      sentAt: z.string(),
      senderIsUser: z.boolean(),
    }),
  }),
  z.object({
    ...deviceEventBase,
    type: z.literal("message_sent"),
    payload: z.object({
      commandId: z.string(),
      draftId: z.string(),
      localMessageReference: z.string().optional(),
      sentAt: z.string(),
    }),
  }),
  z.object({
    ...deviceEventBase,
    type: z.literal("send_failed"),
    payload: z.object({
      commandId: z.string(),
      draftId: z.string().optional(),
      errorCode: z.string(),
      message: z.string().optional(),
    }),
  }),
  z.object({
    ...deviceEventBase,
    type: z.literal("command_expired"),
    payload: z.object({ commandId: z.string() }),
  }),
  z.object({
    ...deviceEventBase,
    type: z.literal("approval_decision"),
    payload: z.object({
      draftId: z.string(),
      decision: z.enum(["send", "edit", "another", "take_over", "stop"]),
      editedText: z.string().optional(),
    }),
  }),
  z.object({
    ...deviceEventBase,
    type: z.literal("health"),
    payload: z.object({
      appVersion: z.string(),
      messagesPermission: z.enum(["ok", "missing", "unknown"]),
      lastMessageCursor: z.string().optional(),
    }),
  }),
]);
export type DeviceEvent = z.infer<typeof deviceEventSchema>;

/** acknowledgement returned for every command/event over the socket */
export const ackSchema = z.object({
  ok: z.boolean(),
  id: z.string(),
  errorCode: z.string().optional(),
  message: z.string().optional(),
});
export type Ack = z.infer<typeof ackSchema>;

/** command lifecycle mirrored in the outbox_commands table */
export const commandStatusSchema = z.enum([
  "created",
  "dispatched",
  "delivered",
  "accepted",
  "executed",
  "acknowledged",
  "failed",
  "expired",
]);
export type CommandStatus = z.infer<typeof commandStatusSchema>;

/** socket.io event names shared by gateway and mac client */
export const SOCKET_EVENTS = {
  command: "soon:command",
  deviceEvent: "soon:device-event",
} as const;
