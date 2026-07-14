import { z } from "zod";

export const followUpAttemptStatusSchema = z.enum([
  "scheduled",
  "awaiting_approval",
  "approved",
  "sending",
  "sent",
  "acknowledged",
  "cancelled",
  "deferred_quiet_hours",
  "expired",
  "failed",
]);
export type FollowUpAttemptStatus = z.infer<typeof followUpAttemptStatusSchema>;

export const quietHoursSchema = z.object({
  /** local wall-clock "HH:mm" — no sends before this */
  earliest: z.string(),
  /** local wall-clock "HH:mm" — no sends at or after this */
  latest: z.string(),
  timezone: z.string(),
});
export type QuietHours = z.infer<typeof quietHoursSchema>;

export const followUpPolicySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  enabled: z.boolean(),
  mode: z.enum(["approve_each", "bundle"]),
  /** hours after the original proposal for each attempt, e.g. [48, 120, 240] */
  intervalHours: z.array(z.number().positive()),
  maximumAttempts: z.number().int().min(1).max(5),
  sessionMaxDays: z.number().int().positive(),
  quietHours: quietHoursSchema,
  weekendsEnabled: z.boolean(),
  requiresApproval: z.boolean(),
  approvalBundleId: z.string().optional(),
});
export type FollowUpPolicy = z.infer<typeof followUpPolicySchema>;

export const DEFAULT_FOLLOW_UP_POLICY = {
  intervalHours: [48, 120, 240],
  maximumAttempts: 3,
  sessionMaxDays: 30,
  quietHours: { earliest: "09:00", latest: "19:00" },
  weekendsEnabled: false,
} as const;

export const followUpAttemptSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  policyId: z.string(),
  attemptNumber: z.number().int().positive(),
  /** ISO instant */
  scheduledFor: z.string(),
  sendWindowStart: z.string().optional(),
  sendWindowEnd: z.string().optional(),
  status: followUpAttemptStatusSchema,
  draftId: z.string().optional(),
  idempotencyKey: z.string(),
});
export type FollowUpAttempt = z.infer<typeof followUpAttemptSchema>;
