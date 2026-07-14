import { describe, expect, it } from "vitest";
import type { FollowUpAttempt, FollowUpAttemptStatus } from "@soon/shared-types";
import { nextAction, onReplyReceived } from "./next-action.js";

const NOW = new Date("2026-07-14T15:00:00.000Z");
const SESSION_STARTED_AT = new Date("2026-07-01T15:00:00.000Z");
const POLICY = { maximumAttempts: 3, sessionMaxDays: 30 };

let seq = 0;
function makeAttempt(
  status: FollowUpAttemptStatus,
  scheduledFor: string,
  overrides: Partial<FollowUpAttempt> = {},
): FollowUpAttempt {
  seq += 1;
  return {
    id: `attempt-${seq}`,
    sessionId: "session-1",
    policyId: "policy-1",
    attemptNumber: seq,
    scheduledFor,
    status,
    idempotencyKey: `key-${seq}`,
    ...overrides,
  };
}

describe("nextAction", () => {
  it("waits until the next scheduled attempt", () => {
    const attempts = [makeAttempt("scheduled", "2026-07-16T15:00:00.000Z")];
    expect(nextAction(POLICY, attempts, NOW, SESSION_STARTED_AT)).toEqual({
      kind: "wait",
      until: new Date("2026-07-16T15:00:00.000Z"),
    });
  });

  it("reports the earliest pending attempt as due once its time passes", () => {
    const due = makeAttempt("scheduled", "2026-07-14T14:00:00.000Z");
    const later = makeAttempt("scheduled", "2026-07-16T15:00:00.000Z");
    expect(nextAction(POLICY, [later, due], NOW, SESSION_STARTED_AT)).toEqual({
      kind: "due",
      attempt: due,
    });
  });

  it("is exhausted when every configured attempt has been sent", () => {
    const attempts = [
      makeAttempt("sent", "2026-07-05T15:00:00.000Z"),
      makeAttempt("sent", "2026-07-08T15:00:00.000Z"),
      makeAttempt("sent", "2026-07-12T15:00:00.000Z"),
    ];
    expect(nextAction(POLICY, attempts, NOW, SESSION_STARTED_AT)).toEqual({ kind: "exhausted" });
  });

  it("is exhausted when nothing is pending, even below the maximum", () => {
    const attempts = [makeAttempt("sent", "2026-07-05T15:00:00.000Z")];
    expect(nextAction(POLICY, attempts, NOW, SESSION_STARTED_AT)).toEqual({ kind: "exhausted" });
  });

  it("cancelled attempts do not count toward the maximum", () => {
    const attempts = [
      makeAttempt("sent", "2026-07-05T15:00:00.000Z"),
      makeAttempt("cancelled", "2026-07-08T15:00:00.000Z"),
      makeAttempt("cancelled", "2026-07-10T15:00:00.000Z"),
      makeAttempt("scheduled", "2026-07-16T15:00:00.000Z"),
    ];
    expect(nextAction(POLICY, attempts, NOW, SESSION_STARTED_AT)).toEqual({
      kind: "wait",
      until: new Date("2026-07-16T15:00:00.000Z"),
    });
  });

  it("expires the session past sessionMaxDays, taking precedence over due attempts", () => {
    const attempts = [makeAttempt("scheduled", "2026-07-14T14:00:00.000Z")];
    const oldStart = new Date("2026-06-01T15:00:00.000Z"); // 43 days before now
    expect(nextAction(POLICY, attempts, NOW, oldStart)).toEqual({ kind: "session_expired" });
  });

  it("does not expire exactly at the session age boundary", () => {
    const boundaryStart = new Date("2026-06-14T15:00:00.000Z"); // exactly 30 days
    const attempts = [makeAttempt("scheduled", "2026-07-16T15:00:00.000Z")];
    expect(nextAction(POLICY, attempts, NOW, boundaryStart).kind).toBe("wait");
  });

  it("treats deferred and awaiting-approval attempts as pending", () => {
    const deferred = makeAttempt("deferred_quiet_hours", "2026-07-15T13:00:00.000Z");
    expect(nextAction(POLICY, [deferred], NOW, SESSION_STARTED_AT)).toEqual({
      kind: "wait",
      until: new Date("2026-07-15T13:00:00.000Z"),
    });
    const awaiting = makeAttempt("awaiting_approval", "2026-07-14T14:00:00.000Z");
    expect(nextAction(POLICY, [awaiting], NOW, SESSION_STARTED_AT)).toEqual({
      kind: "due",
      attempt: awaiting,
    });
  });
});

describe("onReplyReceived", () => {
  it("cancels every pending or scheduled attempt", () => {
    const scheduled = makeAttempt("scheduled", "2026-07-16T15:00:00.000Z");
    const deferred = makeAttempt("deferred_quiet_hours", "2026-07-17T13:00:00.000Z");
    const awaiting = makeAttempt("awaiting_approval", "2026-07-18T13:00:00.000Z");
    const approved = makeAttempt("approved", "2026-07-19T13:00:00.000Z");
    const sent = makeAttempt("sent", "2026-07-10T15:00:00.000Z");
    const cancelled = makeAttempt("cancelled", "2026-07-11T15:00:00.000Z");
    expect(onReplyReceived([scheduled, deferred, awaiting, approved, sent, cancelled])).toEqual([
      scheduled.id,
      deferred.id,
      awaiting.id,
      approved.id,
    ]);
  });

  it("returns an empty list when nothing is pending", () => {
    expect(onReplyReceived([makeAttempt("sent", "2026-07-10T15:00:00.000Z")])).toEqual([]);
  });
});
