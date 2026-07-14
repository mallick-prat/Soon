import { z } from "zod";
import { availabilityConstraintsSchema, meetingFormatSchema } from "./scheduling.js";

export const parsedIntentSchema = z.enum([
  "accept_slot",
  "reject_slots",
  "provide_constraint",
  "provide_email",
  "change_duration",
  "change_format",
  "change_location",
  "add_attendee",
  "reschedule",
  "cancel",
  "unrelated",
  "sensitive",
  "ambiguous",
]);
export type ParsedIntent = z.infer<typeof parsedIntentSchema>;

export const parsedSchedulingMessageSchema = z.object({
  intent: parsedIntentSchema,
  acceptedSlotId: z.string().optional(),
  availabilityConstraints: availabilityConstraintsSchema.optional(),
  email: z.string().optional(),
  requestedDurationMinutes: z.number().int().positive().optional(),
  meetingFormat: meetingFormatSchema.optional(),
  locationText: z.string().optional(),
  addedAttendees: z
    .array(
      z.object({
        name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
      }),
    )
    .optional(),
  confidence: z.number().min(0).max(1),
  requiresUserJudgment: z.boolean(),
  bundleBoundaryReason: z.string().optional(),
});
export type ParsedSchedulingMessage = z.infer<typeof parsedSchedulingMessageSchema>;

/** below this confidence, drafts require explicit user review regardless of bundles */
export const CONFIDENCE_REVIEW_THRESHOLD = 0.7;
