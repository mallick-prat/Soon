import type { CandidateSlot, ParsedSchedulingMessage, SchedulingSession, SchedulingState } from "@soon/shared-types";
import { CONFIDENCE_REVIEW_THRESHOLD } from "@soon/shared-types";

export type ReplyRoute = {
  nextState: SchedulingState;
  action:
    | { kind: "confirm_slot"; slotId: string }
    | { kind: "new_round"; constraints: ParsedSchedulingMessage["availabilityConstraints"] }
    | { kind: "ask_email" }
    | { kind: "record_email"; email: string }
    | { kind: "pause_for_user"; reason: string }
    | { kind: "reschedule" }
    | { kind: "cancel" }
    | { kind: "ignore" };
};

/**
 * deterministic routing of an interpreted attendee reply. the llm classified
 * the message; this function decides what the workflow does about it, and it
 * alone decides — low confidence or judgment flags always go to the user.
 */
export function routeReply(
  session: SchedulingSession,
  parsed: ParsedSchedulingMessage,
  proposedSlots: CandidateSlot[],
  attendeeEmailKnown: boolean,
): ReplyRoute {
  if (parsed.requiresUserJudgment || parsed.confidence < CONFIDENCE_REVIEW_THRESHOLD) {
    return {
      nextState: "needs_user_input",
      action: { kind: "pause_for_user", reason: parsed.bundleBoundaryReason ?? "low_confidence" },
    };
  }

  switch (parsed.intent) {
    case "accept_slot": {
      const slot = proposedSlots.find((s) => s.id === parsed.acceptedSlotId);
      if (!slot) {
        return {
          nextState: "needs_user_input",
          action: { kind: "pause_for_user", reason: "accepted_slot_not_recognized" },
        };
      }
      return attendeeEmailKnown
        ? { nextState: "confirming_slot", action: { kind: "confirm_slot", slotId: slot.id } }
        : { nextState: "waiting_for_email", action: { kind: "ask_email" } };
    }
    case "provide_email":
      return parsed.email
        ? { nextState: "confirming_slot", action: { kind: "record_email", email: parsed.email } }
        : { nextState: "needs_user_input", action: { kind: "pause_for_user", reason: "email_missing" } };
    case "reject_slots":
    case "provide_constraint":
      return {
        nextState: "finding_alternative_slots",
        action: { kind: "new_round", constraints: parsed.availabilityConstraints },
      };
    case "change_duration":
    case "change_format":
    case "change_location":
      // material meeting changes re-run candidate generation with new params;
      // bundle enforcement happens at draft time
      return {
        nextState: "finding_alternative_slots",
        action: { kind: "new_round", constraints: parsed.availabilityConstraints },
      };
    case "add_attendee":
      return { nextState: "needs_user_input", action: { kind: "pause_for_user", reason: "new_attendee" } };
    case "reschedule":
      return { nextState: "rescheduling", action: { kind: "reschedule" } };
    case "cancel":
      return { nextState: "cancelling", action: { kind: "cancel" } };
    case "sensitive":
      return { nextState: "needs_user_input", action: { kind: "pause_for_user", reason: "sensitive" } };
    case "unrelated":
      // stay in the current waiting state; consume nothing
      return { nextState: session.state, action: { kind: "ignore" } };
    case "ambiguous":
    default:
      return { nextState: "needs_user_input", action: { kind: "pause_for_user", reason: "ambiguous" } };
  }
}
