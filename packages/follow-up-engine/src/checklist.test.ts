import { describe, expect, it } from "vitest";
import type { ApprovalBundle } from "@soon/shared-types";
import { evaluatePreSendChecklist, type PreSendSnapshot } from "./checklist.js";

// tuesday 2026-07-14 11:00 edt — inside the default send window
const NOW = new Date("2026-07-14T15:00:00.000Z");

function makeBundle(overrides: Partial<ApprovalBundle> = {}): ApprovalBundle {
  return {
    id: "bundle-1",
    sessionId: "session-1",
    allowedObjectives: ["follow_up"],
    approvedSlotIds: [],
    approvedDateRangeStart: "2026-07-14",
    approvedDateRangeEnd: "2026-07-21",
    minimumDurationMinutes: 30,
    maximumDurationMinutes: 60,
    approvedParticipantIds: ["alex"],
    maximumOutboundMessages: 3,
    messagesUsed: 0,
    expiresAt: "2026-07-15T15:00:00.000Z",
    status: "active",
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<PreSendSnapshot> = {}): PreSendSnapshot {
  return {
    now: NOW,
    sessionActive: true,
    lastActionAt: new Date("2026-07-14T12:00:00.000Z"),
    requiresBundle: false,
    quietHours: { earliest: "09:00", latest: "19:00" },
    weekendsEnabled: false,
    timezone: "america/new_york",
    attendeeDeclined: false,
    attendeeOptedOut: false,
    referencedSlotStarts: [new Date("2026-07-16T15:00:00.000Z")],
    minimumNoticeMinutes: 120,
    conversationMovedOn: false,
    ...overrides,
  };
}

function blockersOf(input: PreSendSnapshot): string[] {
  const result = evaluatePreSendChecklist(input);
  return result.ok ? [] : result.blockers;
}

describe("evaluatePreSendChecklist", () => {
  it("passes a clean snapshot", () => {
    expect(evaluatePreSendChecklist(makeSnapshot())).toEqual({ ok: true });
  });

  it("blocks when the session is not active", () => {
    expect(blockersOf(makeSnapshot({ sessionActive: false }))).toContain("session_not_active");
  });

  it("blocks on new inbound since the last action", () => {
    expect(
      blockersOf(makeSnapshot({ lastInboundAt: new Date("2026-07-14T13:00:00.000Z") })),
    ).toContain("new_inbound_since_last_action");
  });

  it("does not block on inbound older than the last action", () => {
    expect(
      evaluatePreSendChecklist(
        makeSnapshot({ lastInboundAt: new Date("2026-07-14T11:00:00.000Z") }),
      ),
    ).toEqual({ ok: true });
  });

  it("blocks when the user replied manually after the last action", () => {
    expect(
      blockersOf(makeSnapshot({ lastManualUserReplyAt: new Date("2026-07-14T14:00:00.000Z") })),
    ).toContain("user_replied_manually");
  });

  it("blocks when a required bundle is missing", () => {
    expect(blockersOf(makeSnapshot({ requiresBundle: true }))).toContain("bundle_invalid");
  });

  it("blocks when the required bundle is expired, exhausted, or inactive", () => {
    for (const bundle of [
      makeBundle({ status: "revoked" }),
      makeBundle({ expiresAt: new Date(NOW.getTime() - 1).toISOString() }),
      makeBundle({ messagesUsed: 3 }),
    ]) {
      expect(blockersOf(makeSnapshot({ requiresBundle: true, bundle }))).toContain(
        "bundle_invalid",
      );
    }
  });

  it("passes with a usable required bundle", () => {
    expect(
      evaluatePreSendChecklist(makeSnapshot({ requiresBundle: true, bundle: makeBundle() })),
    ).toEqual({ ok: true });
  });

  it("blocks outside allowed hours", () => {
    const lateEvening = new Date("2026-07-15T02:30:00.000Z"); // tuesday 22:30 edt
    expect(
      blockersOf(makeSnapshot({ now: lateEvening, referencedSlotStarts: [] })),
    ).toContain("outside_allowed_hours");
  });

  it("blocks on attendee declined or opted out", () => {
    expect(blockersOf(makeSnapshot({ attendeeDeclined: true }))).toContain("attendee_declined");
    expect(blockersOf(makeSnapshot({ attendeeOptedOut: true }))).toContain("attendee_opted_out");
  });

  it("blocks when any referenced slot starts before now + minimum notice", () => {
    expect(
      blockersOf(
        makeSnapshot({
          // 60 minutes out, minimum notice 120
          referencedSlotStarts: [
            new Date("2026-07-16T15:00:00.000Z"),
            new Date("2026-07-14T16:00:00.000Z"),
          ],
        }),
      ),
    ).toContain("candidate_times_stale");
  });

  it("blocks when the conversation has moved on", () => {
    expect(blockersOf(makeSnapshot({ conversationMovedOn: true }))).toContain(
      "conversation_moved_on",
    );
  });

  it("collects every applicable blocker", () => {
    const result = evaluatePreSendChecklist(
      makeSnapshot({
        sessionActive: false,
        attendeeDeclined: true,
        conversationMovedOn: true,
        requiresBundle: true,
      }),
    );
    expect(result).toEqual({
      ok: false,
      blockers: [
        "session_not_active",
        "bundle_invalid",
        "attendee_declined",
        "conversation_moved_on",
      ],
    });
  });
});
