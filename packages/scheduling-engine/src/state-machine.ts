import type { SchedulingState } from "@soon/shared-types";

/**
 * explicit persisted state machine for scheduling sessions.
 * the llm never decides state — transitions are validated here and
 * persisted by the caller before any side effect runs.
 */
const TRANSITIONS: Record<SchedulingState, readonly SchedulingState[]> = {
  triggered: ["understanding_context", "failed", "paused", "taken_over"],
  understanding_context: ["needs_user_input", "finding_initial_slots", "failed", "paused", "taken_over"],
  needs_user_input: ["finding_initial_slots", "drafting_proposal", "expired", "failed", "paused", "taken_over"],
  finding_initial_slots: ["drafting_proposal", "needs_user_input", "failed", "paused", "taken_over"],
  drafting_proposal: ["awaiting_user_approval", "sending_approved_message", "failed", "paused", "taken_over"],
  awaiting_user_approval: ["sending_approved_message", "drafting_proposal", "expired", "paused", "taken_over", "failed"],
  sending_approved_message: ["waiting_for_attendee", "waiting_for_email", "drafting_confirmation", "failed", "paused", "taken_over"],
  waiting_for_attendee: ["interpreting_response", "scheduling_follow_up", "expired", "paused", "taken_over", "failed"],
  interpreting_response: [
    "finding_alternative_slots",
    "waiting_for_email",
    "confirming_slot",
    "needs_user_input",
    "drafting_proposal",
    "waiting_for_attendee",
    "rescheduling",
    "cancelling",
    "paused",
    "taken_over",
    "failed",
  ],
  finding_alternative_slots: ["drafting_proposal", "needs_user_input", "failed", "paused", "taken_over"],
  scheduling_follow_up: ["waiting_for_follow_up", "follow_up_sequence_exhausted", "paused", "taken_over", "failed"],
  waiting_for_follow_up: ["follow_up_due", "interpreting_response", "needs_user_input", "expired", "paused", "taken_over", "failed"],
  follow_up_due: ["drafting_follow_up", "interpreting_response", "follow_up_sequence_exhausted", "needs_user_input", "paused", "taken_over", "failed"],
  drafting_follow_up: ["awaiting_follow_up_approval", "sending_follow_up", "paused", "taken_over", "failed"],
  awaiting_follow_up_approval: ["sending_follow_up", "expired", "paused", "taken_over", "failed"],
  sending_follow_up: ["waiting_for_attendee", "scheduling_follow_up", "failed", "paused", "taken_over"],
  follow_up_sequence_exhausted: ["scheduling_follow_up", "waiting_for_attendee", "expired", "paused", "taken_over", "failed"],
  waiting_for_email: ["interpreting_response", "confirming_slot", "waiting_for_attendee", "scheduling_follow_up", "paused", "taken_over", "failed"],
  confirming_slot: ["creating_event", "finding_alternative_slots", "needs_user_input", "failed", "paused", "taken_over"],
  creating_event: ["drafting_confirmation", "scheduled", "failed", "paused", "taken_over"],
  drafting_confirmation: ["awaiting_user_approval", "sending_approved_message", "scheduled", "failed", "paused", "taken_over"],
  scheduled: ["rescheduling", "cancelling"],
  rescheduling: ["interpreting_response", "finding_alternative_slots", "drafting_proposal", "confirming_slot", "scheduled", "cancelling", "paused", "taken_over", "failed"],
  cancelling: ["failed", "expired", "scheduled"],
  paused: ["triggered", "understanding_context", "needs_user_input", "finding_initial_slots", "drafting_proposal", "awaiting_user_approval", "waiting_for_attendee", "interpreting_response", "waiting_for_email", "confirming_slot", "scheduling_follow_up", "expired", "failed", "taken_over"],
  taken_over: ["waiting_for_attendee", "interpreting_response", "expired", "failed"],
  expired: [],
  failed: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: SchedulingState,
    readonly to: SchedulingState,
  ) {
    super(`invalid scheduling state transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: SchedulingState, to: SchedulingState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** returns the new state or throws InvalidTransitionError */
export function transition(from: SchedulingState, to: SchedulingState): SchedulingState {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
  return to;
}

export function isTerminal(state: SchedulingState): boolean {
  return TRANSITIONS[state].length === 0;
}
