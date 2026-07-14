import { describe, expect, it } from "vitest";
import type { FollowUpAttempt, FollowUpPolicy } from "@soon/shared-types";
import type { PreSendSnapshot } from "@soon/follow-up-engine";
import { runFollowUpTick } from "./follow-up-runner.js";
import { FakeDispatcher, FakeInterpreter, FakeStore, fixedClock, makeSession } from "./fakes.js";

const POLICY: FollowUpPolicy = {
  id: "policy-1",
  sessionId: "session-1",
  enabled: true,
  mode: "bundle",
  intervalHours: [48, 120, 240],
  maximumAttempts: 3,
  sessionMaxDays: 30,
  quietHours: { earliest: "09:00", latest: "19:00", timezone: "America/New_York" },
  weekendsEnabled: false,
  requiresApproval: false,
  approvalBundleId: "bundle-1",
};

function attempt(n: number, scheduledFor: string, status: FollowUpAttempt["status"]): FollowUpAttempt {
  return {
    id: `attempt-${n}`,
    sessionId: "session-1",
    policyId: "policy-1",
    attemptNumber: n,
    scheduledFor,
    status,
    idempotencyKey: `fu:session-1:${n}`,
  };
}

function cleanSnapshot(now: string): Omit<PreSendSnapshot, "now"> {
  return {
    sessionActive: true,
    lastActionAt: new Date("2026-07-13T16:00:00Z"),
    requiresBundle: false,
    quietHours: POLICY.quietHours,
    weekendsEnabled: false,
    timezone: "America/New_York",
    attendeeDeclined: false,
    attendeeOptedOut: false,
    referencedSlotStarts: [new Date(new Date(now).getTime() + 72 * 3_600_000)],
    minimumNoticeMinutes: 120,
    conversationMovedOn: false,
  } as Omit<PreSendSnapshot, "now">;
}

function deps(state = "follow_up_due" as const) {
  const session = makeSession({ state });
  const store = new FakeStore(session);
  const interpreter = new FakeInterpreter();
  const dispatcher = new FakeDispatcher();
  return { store, interpreter, dispatcher, session };
}

describe("runFollowUpTick", () => {
  // wednesday 2026-07-15 at noon eastern
  const NOW = "2026-07-15T16:00:00Z";

  it("sends a due follow-up under a bundle with the attempt's idempotency key", async () => {
    const d = deps();
    const attempts = [attempt(1, "2026-07-15T15:00:00Z", "scheduled")];
    const result = await runFollowUpTick(
      { ...d, clock: fixedClock(NOW) },
      d.session,
      POLICY,
      attempts,
      cleanSnapshot(NOW),
      "conv-ref",
      [],
    );
    expect(result).toEqual({ kind: "sent", attemptNumber: 1 });
    expect(d.dispatcher.sends[0]!.idempotencyKey).toBe("fu:session-1:1");
  });

  it("blocks when a new inbound message arrived", async () => {
    const d = deps();
    const attempts = [attempt(1, "2026-07-15T15:00:00Z", "scheduled")];
    const snapshot = { ...cleanSnapshot(NOW), lastInboundAt: new Date("2026-07-15T15:30:00Z") };
    const result = await runFollowUpTick(
      { ...d, clock: fixedClock(NOW) },
      d.session,
      POLICY,
      attempts,
      snapshot,
      "conv-ref",
      [],
    );
    expect(result.kind).toBe("blocked");
    expect(d.dispatcher.sends).toHaveLength(0);
  });

  it("reports exhaustion and asks the user privately", async () => {
    const d = deps();
    const attempts = [
      attempt(1, "2026-07-10T15:00:00Z", "acknowledged"),
      attempt(2, "2026-07-12T15:00:00Z", "acknowledged"),
      attempt(3, "2026-07-14T15:00:00Z", "acknowledged"),
    ];
    const result = await runFollowUpTick(
      { ...d, clock: fixedClock(NOW) },
      d.session,
      POLICY,
      attempts,
      cleanSnapshot(NOW),
      "conv-ref",
      [],
    );
    expect(result.kind).toBe("exhausted");
    expect(d.dispatcher.notifications.some((n) => n.title === "keep trying?")).toBe(true);
  });

  it("waits (quiet-hours adjusted) when the next attempt is in the future", async () => {
    const d = deps();
    // next attempt scheduled saturday 22:00 eastern → weekends off, quiet hours →
    // must defer to monday 09:00 eastern
    const attempts = [attempt(1, "2026-07-19T02:00:00Z", "scheduled")]; // sat 22:00 edt = sun 02:00 utc
    const result = await runFollowUpTick(
      { ...d, clock: fixedClock(NOW) },
      d.session,
      POLICY,
      attempts,
      cleanSnapshot(NOW),
      "conv-ref",
      [],
    );
    expect(result.kind).toBe("wait");
    if (result.kind === "wait") {
      // monday 2026-07-20 09:00 america/new_york = 13:00 utc
      expect(result.until.toISOString()).toBe("2026-07-20T13:00:00.000Z");
    }
  });

  it("requests approval instead of sending when the policy requires it", async () => {
    const d = deps();
    const attempts = [attempt(1, "2026-07-15T15:00:00Z", "scheduled")];
    const policy = { ...POLICY, requiresApproval: true };
    const result = await runFollowUpTick(
      { ...d, clock: fixedClock(NOW) },
      d.session,
      policy,
      attempts,
      cleanSnapshot(NOW),
      "conv-ref",
      [],
    );
    expect(result.kind).toBe("awaiting_approval");
    expect(d.dispatcher.sends).toHaveLength(0);
    expect((await d.store.get("session-1")).state).toBe("awaiting_follow_up_approval");
  });
});
