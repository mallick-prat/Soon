import { describe, expect, it } from "vitest";
import type {
  ApprovalBundle as DbBundle,
  CandidateSlot as DbSlot,
  SchedulingSession as DbSession,
} from "@soon/database";

import { toDomainBundle, toDomainSession, toDomainSlot } from "./prisma-session-store.js";

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
