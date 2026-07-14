import { z } from "zod";

export const SCHEDULING_STATES = [
  "triggered",
  "understanding_context",
  "needs_user_input",
  "finding_initial_slots",
  "drafting_proposal",
  "awaiting_user_approval",
  "sending_approved_message",
  "waiting_for_attendee",
  "interpreting_response",
  "finding_alternative_slots",
  "scheduling_follow_up",
  "waiting_for_follow_up",
  "follow_up_due",
  "drafting_follow_up",
  "awaiting_follow_up_approval",
  "sending_follow_up",
  "follow_up_sequence_exhausted",
  "waiting_for_email",
  "confirming_slot",
  "creating_event",
  "drafting_confirmation",
  "scheduled",
  "rescheduling",
  "cancelling",
  "paused",
  "taken_over",
  "expired",
  "failed",
] as const;

export const schedulingStateSchema = z.enum(SCHEDULING_STATES);
export type SchedulingState = z.infer<typeof schedulingStateSchema>;

export const APPROVAL_STATES = [
  "not_required",
  "pending",
  "approved_once",
  "approved_by_bundle",
  "edited_and_approved",
  "rejected",
  "expired",
] as const;

export const approvalStateSchema = z.enum(APPROVAL_STATES);
export type ApprovalState = z.infer<typeof approvalStateSchema>;

/** states in which a session still appears in "upcoming conversations" */
export const UNRESOLVED_STATES: readonly SchedulingState[] = SCHEDULING_STATES.filter(
  (s) => !["scheduled", "expired", "failed", "cancelling"].includes(s),
);

export const TERMINAL_STATES: readonly SchedulingState[] = ["scheduled", "expired", "failed"];
