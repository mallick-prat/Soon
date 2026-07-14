import { z } from "zod";

export const workingHoursSchema = z.object({
  /** 0 = sunday … 6 = saturday */
  weekday: z.number().int().min(0).max(6),
  /** local wall-clock "HH:mm" */
  start: z.string(),
  /** local wall-clock "HH:mm" */
  end: z.string(),
});
export type WorkingHours = z.infer<typeof workingHoursSchema>;

export const preferredWindowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  start: z.string(),
  end: z.string(),
  /** additive score bonus for slots inside this window */
  weight: z.number().default(1),
});
export type PreferredWindow = z.infer<typeof preferredWindowSchema>;

export const calendarPreferencesSchema = z.object({
  destinationCalendarId: z.string(),
  blockingCalendarIds: z.array(z.string()),
  excludedCalendarIds: z.array(z.string()).default([]),
  defaultDurationMinutes: z.number().int().positive().default(30),
  minimumNoticeMinutes: z.number().int().nonnegative().default(120),
  bufferBeforeMinutes: z.number().int().nonnegative().default(0),
  bufferAfterMinutes: z.number().int().nonnegative().default(0),
  maximumMeetingsPerDay: z.number().int().positive().default(8),
  workingHours: z.array(workingHoursSchema),
  preferredWindows: z.array(preferredWindowSchema).default([]),
  weekendEnabled: z.boolean().default(false),
  videoDefault: z.enum(["meet", "none"]).default("meet"),
  timezone: z.string(),
  /** whether tentative events block availability */
  tentativeBlocks: z.boolean().default(true),
  travelBufferMinutes: z.number().int().nonnegative().default(30),
});
export type CalendarPreferences = z.infer<typeof calendarPreferencesSchema>;

export const approvalModeSchema = z.enum(["approve_every", "bundle", "calendar_only"]);
export type ApprovalMode = z.infer<typeof approvalModeSchema>;

export const relationshipTypeSchema = z.enum([
  "close_friend",
  "casual_acquaintance",
  "founder",
  "investor",
  "colleague",
  "mentor",
  "professional_contact",
  "family",
  "unknown",
]);
export type RelationshipType = z.infer<typeof relationshipTypeSchema>;
