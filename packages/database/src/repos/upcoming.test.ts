import { describe, expect, it } from "vitest";
import {
  compareUpcoming,
  upcomingCategory,
  type UpcomingSortable,
} from "./upcoming.js";
import { SchedulingState } from "../generated/prisma/enums.js";

const NOW = new Date("2026-07-14T15:00:00.000Z");

function session(partial: Partial<UpcomingSortable>): UpcomingSortable {
  return {
    state: SchedulingState.waiting_for_attendee,
    waitingOn: null,
    nextActionAt: null,
    nextActionType: null,
    snoozedUntil: null,
    updatedAt: new Date("2026-07-14T12:00:00.000Z"),
    ...partial,
  };
}

describe("upcomingCategory", () => {
  it("classifies sessions waiting on the user as needs_user", () => {
    expect(
      upcomingCategory(session({ state: SchedulingState.awaiting_user_approval }), NOW),
    ).toBe("needs_user");
    expect(
      upcomingCategory(session({ state: SchedulingState.needs_user_input }), NOW),
    ).toBe("needs_user");
    expect(
      upcomingCategory(
        session({ state: SchedulingState.interpreting_response, waitingOn: "user" }),
        NOW,
      ),
    ).toBe("needs_user");
    expect(
      upcomingCategory(
        session({ state: SchedulingState.follow_up_sequence_exhausted }),
        NOW,
      ),
    ).toBe("needs_user");
  });

  it("classifies follow-ups due today as follow_up_due", () => {
    expect(
      upcomingCategory(session({ state: SchedulingState.follow_up_due }), NOW),
    ).toBe("follow_up_due");
    expect(
      upcomingCategory(
        session({
          state: SchedulingState.waiting_for_follow_up,
          nextActionType: "send_follow_up",
          nextActionAt: new Date("2026-07-14T20:00:00.000Z"),
        }),
        NOW,
      ),
    ).toBe("follow_up_due");
  });

  it("classifies future follow-ups as follow_up_scheduled", () => {
    expect(
      upcomingCategory(
        session({
          state: SchedulingState.waiting_for_follow_up,
          nextActionType: "send_follow_up",
          nextActionAt: new Date("2026-07-16T10:00:00.000Z"),
        }),
        NOW,
      ),
    ).toBe("follow_up_scheduled");
  });

  it("classifies attendee-blocked sessions as waiting_attendee", () => {
    expect(
      upcomingCategory(session({ state: SchedulingState.waiting_for_attendee }), NOW),
    ).toBe("waiting_attendee");
    expect(
      upcomingCategory(session({ state: SchedulingState.waiting_for_email }), NOW),
    ).toBe("waiting_attendee");
    expect(
      upcomingCategory(
        session({ state: SchedulingState.interpreting_response, waitingOn: "attendee" }),
        NOW,
      ),
    ).toBe("waiting_attendee");
  });

  it("classifies snoozed sessions as snoozed regardless of state", () => {
    expect(
      upcomingCategory(
        session({
          state: SchedulingState.awaiting_user_approval,
          snoozedUntil: new Date("2026-07-15T09:00:00.000Z"),
        }),
        NOW,
      ),
    ).toBe("snoozed");
  });

  it("ignores expired snoozes", () => {
    expect(
      upcomingCategory(
        session({
          state: SchedulingState.awaiting_user_approval,
          snoozedUntil: new Date("2026-07-13T09:00:00.000Z"),
        }),
        NOW,
      ),
    ).toBe("needs_user");
  });

  it("falls back to stalled", () => {
    expect(upcomingCategory(session({ state: SchedulingState.paused }), NOW)).toBe(
      "stalled",
    );
    expect(
      upcomingCategory(
        session({ state: SchedulingState.triggered, waitingOn: "system" }),
        NOW,
      ),
    ).toBe("stalled");
  });
});

describe("compareUpcoming", () => {
  it("orders the full spec sequence: needs user → due today → waiting → scheduled → stalled → snoozed", () => {
    const needsUser = session({ state: SchedulingState.awaiting_user_approval });
    const dueToday = session({ state: SchedulingState.follow_up_due });
    const waiting = session({ state: SchedulingState.waiting_for_attendee });
    const scheduled = session({
      state: SchedulingState.waiting_for_follow_up,
      nextActionType: "send_follow_up",
      nextActionAt: new Date("2026-07-18T10:00:00.000Z"),
    });
    const stalled = session({ state: SchedulingState.paused });
    const snoozed = session({
      state: SchedulingState.waiting_for_attendee,
      snoozedUntil: new Date("2026-07-20T00:00:00.000Z"),
    });

    const shuffled = [snoozed, scheduled, needsUser, stalled, dueToday, waiting];
    const sorted = [...shuffled].sort((a, b) => compareUpcoming(a, b, NOW));
    expect(sorted).toEqual([needsUser, dueToday, waiting, scheduled, stalled, snoozed]);
  });

  it("breaks ties by soonest next action, sessions without one last", () => {
    const soon = session({
      state: SchedulingState.waiting_for_attendee,
      nextActionAt: new Date("2026-07-15T09:00:00.000Z"),
      nextActionType: "nudge_check",
    });
    const later = session({
      state: SchedulingState.waiting_for_attendee,
      nextActionAt: new Date("2026-07-17T09:00:00.000Z"),
      nextActionType: "nudge_check",
    });
    const none = session({ state: SchedulingState.waiting_for_attendee });

    const sorted = [none, later, soon].sort((a, b) => compareUpcoming(a, b, NOW));
    expect(sorted).toEqual([soon, later, none]);
  });

  it("breaks remaining ties by most recently updated first", () => {
    const older = session({ updatedAt: new Date("2026-07-13T08:00:00.000Z") });
    const newer = session({ updatedAt: new Date("2026-07-14T08:00:00.000Z") });
    const sorted = [older, newer].sort((a, b) => compareUpcoming(a, b, NOW));
    expect(sorted).toEqual([newer, older]);
  });
});
