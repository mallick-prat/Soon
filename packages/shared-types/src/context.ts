import { z } from "zod";
import { meetingFormatSchema, meetingTypeSchema } from "./scheduling.js";
import { relationshipTypeSchema } from "./preferences.js";

/**
 * bounded conversation context uploaded from the mac after activation.
 * hard limits: previous 20 text messages, max previous 48 hours.
 */
export const CONTEXT_LIMITS = {
  maxMessages: 20,
  maxAgeHours: 48,
} as const;

export const contextMessageSchema = z.object({
  localMessageReference: z.string(),
  senderType: z.enum(["user", "attendee"]),
  text: z.string(),
  /** ISO instant */
  sentAt: z.string(),
});
export type ContextMessage = z.infer<typeof contextMessageSchema>;

export const activationContextSchema = z.object({
  conversationReference: z.string(),
  triggerMessageReference: z.string(),
  triggerText: z.string(),
  messages: z.array(contextMessageSchema).max(CONTEXT_LIMITS.maxMessages),
  participants: z.array(
    z.object({
      handle: z.string(),
      displayName: z.string().optional(),
      isUser: z.boolean(),
    }),
  ),
  isGroup: z.boolean(),
});
export type ActivationContext = z.infer<typeof activationContextSchema>;

/** structured interpretation of the activation context */
export const interpretedContextSchema = z.object({
  bothPartiesAgreedToMeet: z.boolean(),
  meetingType: meetingTypeSchema.optional(),
  purpose: z.string().optional(),
  format: meetingFormatSchema,
  durationMinutes: z.number().int().positive().optional(),
  dateHints: z.array(z.string()),
  hardConstraints: z.array(z.string()),
  emailPresent: z.string().optional(),
  isProfessional: z.boolean(),
  relationshipGuess: relationshipTypeSchema,
  locationText: z.string().optional(),
  multipleInvitees: z.boolean(),
  sensitive: z.boolean(),
  confidence: z.number().min(0).max(1),
});
export type InterpretedContext = z.infer<typeof interpretedContextSchema>;
