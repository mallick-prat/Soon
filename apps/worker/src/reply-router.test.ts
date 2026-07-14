import { describe, expect, it } from "vitest";
import type { CandidateSlot, ParsedSchedulingMessage } from "@soon/shared-types";
import { routeReply } from "./reply-router.js";
import { makeSession } from "./fakes.js";

const SLOTS: CandidateSlot[] = [
  {
    id: "slot-a",
    sessionId: "session-1",
    startsAt: "2026-07-21T19:00:00Z",
    endsAt: "2026-07-21T19:30:00Z",
    timezone: "America/New_York",
    status: "proposed",
    score: 5,
    proposalRound: 1,
  },
];

function parsed(overrides: Partial<ParsedSchedulingMessage>): ParsedSchedulingMessage {
  return { intent: "ambiguous", confidence: 0.9, requiresUserJudgment: false, ...overrides };
}

const session = makeSession({ state: "interpreting_response" });

describe("routeReply", () => {
  it("routes acceptance to email collection when email unknown", () => {
    const route = routeReply(session, parsed({ intent: "accept_slot", acceptedSlotId: "slot-a" }), SLOTS, false);
    expect(route).toEqual({ nextState: "waiting_for_email", action: { kind: "ask_email" } });
  });

  it("routes acceptance straight to confirmation when email known", () => {
    const route = routeReply(session, parsed({ intent: "accept_slot", acceptedSlotId: "slot-a" }), SLOTS, true);
    expect(route.action).toEqual({ kind: "confirm_slot", slotId: "slot-a" });
  });

  it("pauses when the accepted slot id is not recognized", () => {
    const route = routeReply(session, parsed({ intent: "accept_slot", acceptedSlotId: "slot-zzz" }), SLOTS, true);
    expect(route.nextState).toBe("needs_user_input");
  });

  it("low confidence always goes to the user", () => {
    const route = routeReply(session, parsed({ intent: "accept_slot", acceptedSlotId: "slot-a", confidence: 0.4 }), SLOTS, true);
    expect(route.action.kind).toBe("pause_for_user");
  });

  it("requiresUserJudgment always goes to the user", () => {
    const route = routeReply(session, parsed({ intent: "provide_constraint", requiresUserJudgment: true }), SLOTS, true);
    expect(route.action.kind).toBe("pause_for_user");
  });

  it("rejection starts a new round carrying constraints", () => {
    const route = routeReply(
      session,
      parsed({ intent: "reject_slots", availabilityConstraints: { earliestDate: "2026-07-27" } }),
      SLOTS,
      true,
    );
    expect(route.nextState).toBe("finding_alternative_slots");
    expect(route.action).toMatchObject({ kind: "new_round" });
  });

  it("a new attendee pauses automation", () => {
    const route = routeReply(session, parsed({ intent: "add_attendee" }), SLOTS, true);
    expect(route.nextState).toBe("needs_user_input");
  });

  it("unrelated messages are ignored and keep the session state", () => {
    const route = routeReply(session, parsed({ intent: "unrelated" }), SLOTS, true);
    expect(route.action.kind).toBe("ignore");
    expect(route.nextState).toBe("interpreting_response");
  });

  it("sensitive shifts pause automation", () => {
    const route = routeReply(session, parsed({ intent: "sensitive" }), SLOTS, true);
    expect(route.action.kind).toBe("pause_for_user");
  });

  it("reschedule and cancel route to their states", () => {
    expect(routeReply(session, parsed({ intent: "reschedule" }), SLOTS, true).nextState).toBe("rescheduling");
    expect(routeReply(session, parsed({ intent: "cancel" }), SLOTS, true).nextState).toBe("cancelling");
  });

  it("provided email routes to confirmation", () => {
    const route = routeReply(session, parsed({ intent: "provide_email", email: "alex@example.com" }), SLOTS, false);
    expect(route.action).toEqual({ kind: "record_email", email: "alex@example.com" });
  });
});
