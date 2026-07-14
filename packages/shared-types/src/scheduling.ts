import { z } from "zod";

export const meetingFormatSchema = z.enum(["virtual", "phone", "in_person", "unspecified"]);
export type MeetingFormat = z.infer<typeof meetingFormatSchema>;

export const meetingTypeSchema = z.enum([
  "quick_call",
  "catch_up",
  "coffee",
  "lunch",
  "dinner",
  "meeting",
]);
export type MeetingType = z.infer<typeof meetingTypeSchema>;

/** default durations per meeting preset, in minutes */
export const MEETING_PRESET_DURATIONS: Record<MeetingType, number> = {
  quick_call: 15,
  catch_up: 30,
  coffee: 45,
  lunch: 60,
  dinner: 90,
  meeting: 30,
};

export const candidateSlotStatusSchema = z.enum([
  "candidate",
  "proposed",
  "accepted",
  "rejected",
  "stale",
  "booked",
]);
export type CandidateSlotStatus = z.infer<typeof candidateSlotStatusSchema>;

export const candidateSlotSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  /** ISO instant */
  startsAt: z.string(),
  /** ISO instant */
  endsAt: z.string(),
  /** IANA timezone the slot was generated for display in */
  timezone: z.string(),
  status: candidateSlotStatusSchema,
  score: z.number(),
  proposalRound: z.number().int().nonnegative(),
});
export type CandidateSlot = z.infer<typeof candidateSlotSchema>;

export const timeWindowSchema = z.object({
  /** ISO instant */
  start: z.string(),
  /** ISO instant */
  end: z.string(),
  timezone: z.string().optional(),
});
export type TimeWindow = z.infer<typeof timeWindowSchema>;

export const availabilityConstraintsSchema = z.object({
  earliestDate: z.string().optional(),
  latestDate: z.string().optional(),
  /** 0 = sunday … 6 = saturday */
  allowedWeekdays: z.array(z.number().int().min(0).max(6)).optional(),
  timeWindows: z.array(timeWindowSchema).optional(),
  excludedDates: z.array(z.string()).optional(),
});
export type AvailabilityConstraints = z.infer<typeof availabilityConstraintsSchema>;

export const meetingParametersSchema = z.object({
  meetingType: meetingTypeSchema,
  durationMinutes: z.number().int().positive(),
  format: meetingFormatSchema,
  locationText: z.string().optional(),
  /** ISO date, inclusive */
  dateRangeStart: z.string().optional(),
  /** ISO date, inclusive */
  dateRangeEnd: z.string().optional(),
  timezone: z.string(),
});
export type MeetingParameters = z.infer<typeof meetingParametersSchema>;
