import type { SchedulingState } from "@soon/shared-types";

/** every scheduling state in plain lowercase words for the dashboard */
export const STATE_LABELS: Record<SchedulingState, string> = {
  triggered: "just started",
  understanding_context: "reading the conversation",
  needs_user_input: "needs your input",
  finding_initial_slots: "finding times",
  drafting_proposal: "drafting a proposal",
  awaiting_user_approval: "draft waiting for your review",
  sending_approved_message: "sending your message",
  waiting_for_attendee: "waiting for their reply",
  interpreting_response: "reading their reply",
  finding_alternative_slots: "finding new times",
  scheduling_follow_up: "planning a follow-up",
  waiting_for_follow_up: "follow-up scheduled",
  follow_up_due: "follow-up due today",
  drafting_follow_up: "drafting a follow-up",
  awaiting_follow_up_approval: "follow-up waiting for your review",
  sending_follow_up: "sending the follow-up",
  follow_up_sequence_exhausted: "out of follow-ups — your move",
  waiting_for_email: "waiting for their email",
  confirming_slot: "confirming the time",
  creating_event: "creating the calendar event",
  drafting_confirmation: "drafting the confirmation",
  scheduled: "scheduled",
  rescheduling: "rescheduling",
  cancelling: "cancelling",
  paused: "paused",
  taken_over: "you took over",
  expired: "expired",
  failed: "something went wrong",
};

export const MEETING_TYPE_LABELS: Record<string, string> = {
  quick_call: "quick call",
  catch_up: "catch-up",
  coffee: "coffee",
  lunch: "lunch",
  dinner: "dinner",
  meeting: "meeting",
};

export const MEETING_FORMAT_LABELS: Record<string, string> = {
  virtual: "video",
  phone: "phone",
  in_person: "in person",
  unspecified: "",
};

export const OBJECTIVE_LABELS: Record<string, string> = {
  propose_slots: "proposing times",
  ask_for_constraint: "asking what works",
  ask_for_email: "asking for their email",
  clarify_selection: "clarifying which time",
  confirm_time: "confirming the time",
  confirm_invite: "confirming the invite",
  follow_up: "following up",
  reschedule: "rescheduling",
  cancel: "cancelling",
};

export const CATEGORY_LABELS: Record<string, string> = {
  needs_user: "needs you",
  follow_up_due: "follow-up due today",
  waiting_attendee: "waiting on them",
  follow_up_scheduled: "follow-up scheduled",
  stalled: "stalled",
  snoozed: "snoozed",
};

export const WAITING_ON_LABELS: Record<string, string> = {
  user: "waiting on you",
  attendee: "waiting on them",
  system: "soon is working on it",
};
