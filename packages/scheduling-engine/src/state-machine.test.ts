import { describe, expect, it } from "vitest";
import { canTransition, InvalidTransitionError, isTerminal, transition } from "./state-machine.js";
import { SCHEDULING_STATES } from "@soon/shared-types";

describe("scheduling state machine", () => {
  it("follows the happy path", () => {
    const path = [
      "triggered",
      "understanding_context",
      "finding_initial_slots",
      "drafting_proposal",
      "awaiting_user_approval",
      "sending_approved_message",
      "waiting_for_attendee",
      "interpreting_response",
      "waiting_for_email",
      "confirming_slot",
      "creating_event",
      "drafting_confirmation",
      "awaiting_user_approval",
      "sending_approved_message",
      "drafting_confirmation",
      "scheduled",
    ] as const;
    for (let i = 1; i < path.length; i++) {
      expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
    }
  });

  it("supports the follow-up loop", () => {
    const path = [
      "waiting_for_attendee",
      "scheduling_follow_up",
      "waiting_for_follow_up",
      "follow_up_due",
      "drafting_follow_up",
      "awaiting_follow_up_approval",
      "sending_follow_up",
      "waiting_for_attendee",
    ] as const;
    for (let i = 1; i < path.length; i++) {
      expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
    }
  });

  it("cancels pending follow-up when a reply arrives", () => {
    expect(canTransition("waiting_for_follow_up", "interpreting_response")).toBe(true);
    expect(canTransition("follow_up_due", "interpreting_response")).toBe(true);
  });

  it("rejects nonsense transitions", () => {
    expect(canTransition("triggered", "scheduled")).toBe(false);
    expect(canTransition("scheduled", "drafting_proposal")).toBe(false);
    expect(() => transition("expired", "triggered")).toThrow(InvalidTransitionError);
  });

  it("terminal states have no exits except scheduled->reschedule/cancel", () => {
    expect(isTerminal("expired")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(canTransition("scheduled", "rescheduling")).toBe(true);
    expect(canTransition("scheduled", "cancelling")).toBe(true);
  });

  it("every state can be paused or is terminal-ish", () => {
    for (const state of SCHEDULING_STATES) {
      const pausable = canTransition(state, "paused");
      const terminal = ["scheduled", "expired", "failed", "cancelling", "paused", "taken_over"].includes(state);
      expect(pausable || terminal).toBe(true);
    }
  });
});
