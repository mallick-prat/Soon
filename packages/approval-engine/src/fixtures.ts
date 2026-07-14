import type { ApprovalBundle, OutboundDraft, ParsedSchedulingMessage } from "@soon/shared-types";

/** shared test builders — not exported from the package entry point */

export const NOW = new Date("2026-07-14T15:00:00.000Z");

export function makeBundle(overrides: Partial<ApprovalBundle> = {}): ApprovalBundle {
  return {
    id: "bundle-1",
    sessionId: "session-1",
    allowedObjectives: ["propose_slots", "confirm_time", "follow_up", "ask_for_email"],
    approvedSlotIds: ["slot-a", "slot-b", "slot-c"],
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

export function makeDraft(overrides: Partial<OutboundDraft> = {}): OutboundDraft {
  return {
    id: "draft-1",
    sessionId: "session-1",
    objective: "propose_slots",
    text: "would tuesday at 2pm or wednesday at 10am work?",
    alternativeTexts: [],
    referencedSlotIds: ["slot-a", "slot-b"],
    confidence: 0.95,
    requiresApproval: false,
    expiresAt: "2026-07-15T15:00:00.000Z",
    ...overrides,
  };
}

export function makeParsed(
  overrides: Partial<ParsedSchedulingMessage> = {},
): ParsedSchedulingMessage {
  return {
    intent: "accept_slot",
    confidence: 0.9,
    requiresUserJudgment: false,
    ...overrides,
  };
}
