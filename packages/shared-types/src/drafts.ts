import { z } from "zod";

export const draftObjectiveSchema = z.enum([
  "propose_slots",
  "ask_for_constraint",
  "ask_for_email",
  "clarify_selection",
  "confirm_time",
  "confirm_invite",
  "follow_up",
  "reschedule",
  "cancel",
]);
export type DraftObjective = z.infer<typeof draftObjectiveSchema>;

export const outboundDraftSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  objective: draftObjectiveSchema,
  text: z.string(),
  alternativeTexts: z.array(z.string()),
  referencedSlotIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  requiresApproval: z.boolean(),
  approvalBundleId: z.string().optional(),
  /** ISO instant after which this draft must not be sent */
  expiresAt: z.string(),
});
export type OutboundDraft = z.infer<typeof outboundDraftSchema>;
