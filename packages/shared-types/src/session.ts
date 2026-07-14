import { z } from "zod";
import { schedulingStateSchema } from "./states.js";
import { meetingFormatSchema, meetingTypeSchema } from "./scheduling.js";
import { approvalModeSchema } from "./preferences.js";

export const sessionMessageSenderSchema = z.enum(["user", "attendee"]);
export type SessionMessageSender = z.infer<typeof sessionMessageSenderSchema>;

export const sessionMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  localMessageReference: z.string(),
  senderType: sessionMessageSenderSchema,
  direction: z.enum(["inbound", "outbound"]),
  sanitizedText: z.string(),
  /** ISO instant */
  messageTimestamp: z.string(),
});
export type SessionMessage = z.infer<typeof sessionMessageSchema>;

export const schedulingSessionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  conversationId: z.string(),
  state: schedulingStateSchema,
  meetingType: meetingTypeSchema,
  title: z.string().optional(),
  durationMinutes: z.number().int().positive(),
  meetingFormat: meetingFormatSchema,
  location: z.string().optional(),
  timezone: z.string(),
  dateRangeStart: z.string().optional(),
  dateRangeEnd: z.string().optional(),
  calendarEventId: z.string().optional(),
  approvalMode: approvalModeSchema,
  activeApprovalBundleId: z.string().optional(),
  proposalRound: z.number().int().nonnegative(),
  outboundMessageCount: z.number().int().nonnegative(),
  waitingOn: z.enum(["user", "attendee", "system"]).optional(),
  nextActionAt: z.string().optional(),
  nextActionType: z.string().optional(),
  sensitive: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SchedulingSession = z.infer<typeof schedulingSessionSchema>;

/** negotiation thresholds before the session pauses for private review */
export const NEGOTIATION_LIMITS = {
  maxProposalRounds: 3,
  maxElapsedDays: 7,
  maxOutboundMessages: 10,
  maxRejectedCandidateSets: 3,
} as const;
