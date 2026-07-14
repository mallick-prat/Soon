import { z } from "zod";
import { draftObjectiveSchema } from "./drafts.js";

export const bundleObjectiveSchema = draftObjectiveSchema.exclude(["reschedule", "cancel"]);
export type BundleObjective = z.infer<typeof bundleObjectiveSchema>;

export const approvalBundleStatusSchema = z.enum(["active", "expired", "consumed", "revoked"]);
export type ApprovalBundleStatus = z.infer<typeof approvalBundleStatusSchema>;

export const approvalBundleSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  allowedObjectives: z.array(bundleObjectiveSchema),
  approvedSlotIds: z.array(z.string()),
  /** ISO date, inclusive */
  approvedDateRangeStart: z.string(),
  /** ISO date, inclusive */
  approvedDateRangeEnd: z.string(),
  minimumDurationMinutes: z.number().int().positive(),
  maximumDurationMinutes: z.number().int().positive(),
  approvedParticipantIds: z.array(z.string()),
  maximumOutboundMessages: z.number().int().positive(),
  messagesUsed: z.number().int().nonnegative(),
  /** ISO instant */
  expiresAt: z.string(),
  status: approvalBundleStatusSchema,
});
export type ApprovalBundle = z.infer<typeof approvalBundleSchema>;

/** hard product defaults for bundle expiration */
export const BUNDLE_DEFAULTS = {
  maximumOutboundMessages: 3,
  maxAgeHours: 24,
} as const;
