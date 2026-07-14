import { describe, expect, it } from "vitest";
import { DEFAULT_FOLLOW_UP_POLICY } from "@soon/shared-types";
import { computeFollowUpSchedule } from "./schedule.js";

const PROPOSAL_AT = new Date("2026-07-14T15:00:00.000Z");

describe("computeFollowUpSchedule", () => {
  it("plans attempts at proposal + each interval with the default policy", () => {
    const schedule = computeFollowUpSchedule(
      {
        intervalHours: [...DEFAULT_FOLLOW_UP_POLICY.intervalHours],
        maximumAttempts: DEFAULT_FOLLOW_UP_POLICY.maximumAttempts,
      },
      PROPOSAL_AT,
    );
    expect(schedule).toEqual([
      { attemptNumber: 1, scheduledFor: new Date("2026-07-16T15:00:00.000Z") },
      { attemptNumber: 2, scheduledFor: new Date("2026-07-19T15:00:00.000Z") },
      { attemptNumber: 3, scheduledFor: new Date("2026-07-24T15:00:00.000Z") },
    ]);
  });

  it("caps planned attempts at maximumAttempts", () => {
    const schedule = computeFollowUpSchedule(
      { intervalHours: [24, 48, 72, 96, 120], maximumAttempts: 2 },
      PROPOSAL_AT,
    );
    expect(schedule).toHaveLength(2);
    expect(schedule[1]?.scheduledFor).toEqual(new Date("2026-07-16T15:00:00.000Z"));
  });

  it("supports up to five configurable attempts", () => {
    const schedule = computeFollowUpSchedule(
      { intervalHours: [12, 24, 48, 96, 192], maximumAttempts: 5 },
      PROPOSAL_AT,
    );
    expect(schedule.map((a) => a.attemptNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(schedule[4]?.scheduledFor).toEqual(new Date("2026-07-22T15:00:00.000Z"));
  });

  it("plans only as many attempts as there are intervals", () => {
    const schedule = computeFollowUpSchedule(
      { intervalHours: [48], maximumAttempts: 3 },
      PROPOSAL_AT,
    );
    expect(schedule).toHaveLength(1);
  });
});
