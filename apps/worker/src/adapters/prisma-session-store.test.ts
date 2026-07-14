import { describe, expect, it } from "vitest";
import type {
  ApprovalBundle as DbBundle,
  CandidateSlot as DbSlot,
  FollowUpAttempt as DbAttempt,
  FollowUpPolicy as DbPolicy,
  SchedulingSession as DbSession,
} from "@soon/database";
import type { FollowUpPolicy } from "@soon/shared-types";
import { evaluatePreSendChecklist } from "@soon/follow-up-engine";

import {
  buildPreSendSnapshot,
  toDomainBundle,
  toDomainFollowUpAttempt,
  toDomainFollowUpPolicy,
  toDomainSession,
  toDomainSlot,
} from "./prisma-session-store.js";

describe("prisma → domain mappers", () => {
  it("maps a session, converting Dates to ISO and null to omitted", () => {
    const row = {
      id: "s1",
      userId: "u1",
      conversationId: "c1",
      state: "awaiting_user_approval",
      meetingType: "coffee",
      title: null,
      durationMinutes: 45,
      meetingFormat: "in_person",
      location: "blue bottle",
      timezone: "America/New_York",
      dateRangeStart: new Date("2026-07-20T00:00:00.000Z"),
      dateRangeEnd: null,
      calendarEventId: null,
      approvalMode: "approve_every",
      activeApprovalBundleId: null,
      proposalRound: 1,
      outboundMessageCount: 2,
      waitingOn: "attendee",
      nextActionAt: null,
      nextActionType: null,
      sensitive: false,
      createdAt: new Date("2026-07-17T12:00:00.000Z"),
      updatedAt: new Date("2026-07-17T13:00:00.000Z"),
    } as unknown as DbSession;

    const domain = toDomainSession(row);
    expect(domain.createdAt).toBe("2026-07-17T12:00:00.000Z");
    expect(domain.dateRangeStart).toBe("2026-07-20T00:00:00.000Z");
    expect(domain.location).toBe("blue bottle");
    expect(domain.waitingOn).toBe("attendee");
    // null columns are omitted, not set to null (exactOptionalPropertyTypes).
    expect("title" in domain).toBe(false);
    expect("dateRangeEnd" in domain).toBe(false);
    expect("activeApprovalBundleId" in domain).toBe(false);
  });

  it("maps a candidate slot", () => {
    const row = {
      id: "slot1",
      sessionId: "s1",
      startsAt: new Date("2026-07-21T19:00:00.000Z"),
      endsAt: new Date("2026-07-21T19:30:00.000Z"),
      timezone: "America/New_York",
      status: "candidate",
      score: 12.5,
      proposalRound: 1,
    } as unknown as DbSlot;

    expect(toDomainSlot(row)).toEqual({
      id: "slot1",
      sessionId: "s1",
      startsAt: "2026-07-21T19:00:00.000Z",
      endsAt: "2026-07-21T19:30:00.000Z",
      timezone: "America/New_York",
      status: "candidate",
      score: 12.5,
      proposalRound: 1,
    });
  });

  it("maps an approval bundle", () => {
    const row = {
      id: "b1",
      sessionId: "s1",
      allowedObjectives: ["propose_slots", "confirm_invite"],
      approvedSlotIds: ["slot1"],
      approvedDateRangeStart: new Date("2026-07-19T00:00:00.000Z"),
      approvedDateRangeEnd: new Date("2026-07-25T00:00:00.000Z"),
      minimumDurationMinutes: 15,
      maximumDurationMinutes: 60,
      approvedParticipantIds: ["contact-1"],
      maximumOutboundMessages: 3,
      messagesUsed: 1,
      expiresAt: new Date("2026-07-18T00:00:00.000Z"),
      status: "active",
    } as unknown as DbBundle;

    const domain = toDomainBundle(row);
    expect(domain.status).toBe("active");
    expect(domain.messagesUsed).toBe(1);
    expect(domain.approvedDateRangeStart).toBe("2026-07-19T00:00:00.000Z");
    expect(domain.expiresAt).toBe("2026-07-18T00:00:00.000Z");
  });
});

const domainPolicy = (over: Partial<FollowUpPolicy> = {}): FollowUpPolicy => ({
  id: "p1",
  sessionId: "s1",
  enabled: true,
  mode: "approve_each",
  intervalHours: [48, 120, 240],
  maximumAttempts: 3,
  sessionMaxDays: 30,
  quietHours: { earliest: "09:00", latest: "19:00", timezone: "America/New_York" },
  weekendsEnabled: false,
  requiresApproval: true,
  ...over,
});

describe("follow-up mappers", () => {
  it("maps a policy: quiet hours gain the session timezone, intervals pass through", () => {
    const row = {
      id: "p1",
      sessionId: "s1",
      enabled: true,
      mode: "bundle",
      intervalHours: [24, 72],
      maximumAttempts: 2,
      sessionMaxDays: 14,
      quietHoursJson: { earliest: "08:00", latest: "20:00" },
      weekendsEnabled: true,
      requiresApproval: false,
      approvalBundleId: null,
    } as unknown as DbPolicy;

    const domain = toDomainFollowUpPolicy(row, "s1", "America/Chicago");
    expect(domain.quietHours).toEqual({ earliest: "08:00", latest: "20:00", timezone: "America/Chicago" });
    expect(domain.intervalHours).toEqual([24, 72]);
    expect(domain.mode).toBe("bundle");
    expect("approvalBundleId" in domain).toBe(false);
  });

  it("defaults a malformed intervalHours json", () => {
    const row = { intervalHours: "nonsense", quietHoursJson: {} } as unknown as DbPolicy;
    expect(toDomainFollowUpPolicy(row, "s1", "UTC").intervalHours).toEqual([48, 120, 240]);
  });

  it("maps an attempt, converting dates and omitting nulls", () => {
    const row = {
      id: "a1",
      sessionId: "s1",
      policyId: "p1",
      attemptNumber: 1,
      scheduledFor: new Date("2026-07-22T13:00:00.000Z"),
      sendWindowStart: null,
      sendWindowEnd: null,
      status: "scheduled",
      draftId: null,
      idempotencyKey: "idem-1",
    } as unknown as DbAttempt;

    const domain = toDomainFollowUpAttempt(row);
    expect(domain.scheduledFor).toBe("2026-07-22T13:00:00.000Z");
    expect(domain.status).toBe("scheduled");
    expect("draftId" in domain).toBe(false);
    expect("sendWindowStart" in domain).toBe(false);
  });
});

describe("buildPreSendSnapshot", () => {
  const base = {
    timezone: "America/New_York",
    lastOutboundAt: new Date("2026-07-20T12:00:00.000Z"),
    updatedAt: new Date("2026-07-20T12:00:00.000Z"),
    lastInboundAt: null,
    bundle: undefined,
    referencedSlotStarts: [] as Date[],
    minimumNoticeMinutes: 120,
  };

  it("passes the real checklist for an active session inside the send window", () => {
    const snapshot = buildPreSendSnapshot({
      ...base,
      sessionState: "waiting_for_follow_up",
      policy: domainPolicy(),
    });
    expect(snapshot.sessionActive).toBe(true);
    expect(snapshot.requiresBundle).toBe(false); // requiresApproval → not a bundle send
    expect(snapshot.lastActionAt).toBe(base.lastOutboundAt);
    // tuesday noon ET — a weekday inside 09:00–19:00.
    const result = evaluatePreSendChecklist({ ...snapshot, now: new Date("2026-07-21T16:00:00.000Z") });
    expect(result.ok).toBe(true);
  });

  it("blocks a paused session via session_not_active", () => {
    const snapshot = buildPreSendSnapshot({ ...base, sessionState: "paused", policy: domainPolicy() });
    expect(snapshot.sessionActive).toBe(false);
    const result = evaluatePreSendChecklist({ ...snapshot, now: new Date("2026-07-21T16:00:00.000Z") });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blockers).toContain("session_not_active");
  });

  it("requires a bundle when approval is not required", () => {
    const snapshot = buildPreSendSnapshot({
      ...base,
      sessionState: "waiting_for_follow_up",
      policy: domainPolicy({ requiresApproval: false }),
    });
    expect(snapshot.requiresBundle).toBe(true);
    // no bundle present → blocked.
    const result = evaluatePreSendChecklist({ ...snapshot, now: new Date("2026-07-21T16:00:00.000Z") });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blockers).toContain("bundle_invalid");
  });
})
