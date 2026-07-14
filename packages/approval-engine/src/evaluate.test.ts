import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { BundleObjective, CandidateSlot, DraftObjective } from "@soon/shared-types";
import { evaluateDraftAgainstBundle, type BundleBoundaryReason } from "./evaluate.js";
import { NOW, makeBundle, makeDraft, makeParsed } from "./fixtures.js";

function reasonTypes(result: ReturnType<typeof evaluateDraftAgainstBundle>): string[] {
  return result.allowed ? [] : result.boundaryReasons.map((r) => r.type);
}

function makeSlot(overrides: Partial<CandidateSlot> = {}): CandidateSlot {
  return {
    id: "slot-a",
    sessionId: "session-1",
    startsAt: "2026-07-15T14:00:00.000Z",
    endsAt: "2026-07-15T14:30:00.000Z",
    timezone: "america/new_york",
    status: "candidate",
    score: 1,
    proposalRound: 0,
    ...overrides,
  };
}

describe("evaluateDraftAgainstBundle", () => {
  it("allows an in-scope draft", () => {
    const result = evaluateDraftAgainstBundle({
      draft: makeDraft(),
      bundle: makeBundle(),
      context: {
        now: NOW,
        proposedSlots: [makeSlot()],
        durationMinutes: 30,
        participantIds: ["alex"],
        parsed: makeParsed(),
      },
    });
    expect(result).toEqual({ allowed: true });
  });

  it("denies when the bundle is not active", () => {
    const result = evaluateDraftAgainstBundle({
      draft: makeDraft(),
      bundle: makeBundle({ status: "revoked" }),
      context: { now: NOW },
    });
    expect(reasonTypes(result)).toContain("bundle_not_active");
  });

  it("denies when the bundle has expired by time even if still marked active", () => {
    const result = evaluateDraftAgainstBundle({
      draft: makeDraft(),
      bundle: makeBundle({ expiresAt: new Date(NOW.getTime() - 1).toISOString() }),
      context: { now: NOW },
    });
    expect(reasonTypes(result)).toContain("bundle_expired");
  });

  it("denies when the message limit is reached", () => {
    const result = evaluateDraftAgainstBundle({
      draft: makeDraft(),
      bundle: makeBundle({ messagesUsed: 3, maximumOutboundMessages: 3 }),
      context: { now: NOW },
    });
    expect(reasonTypes(result)).toContain("message_limit_reached");
  });

  it("denies an objective outside allowedObjectives", () => {
    const result = evaluateDraftAgainstBundle({
      draft: makeDraft({ objective: "cancel", referencedSlotIds: [] }),
      bundle: makeBundle(),
      context: { now: NOW },
    });
    expect(reasonTypes(result)).toContain("objective_not_allowed");
  });

  it("denies slot references outside approvedSlotIds for propose/confirm objectives", () => {
    const result = evaluateDraftAgainstBundle({
      draft: makeDraft({ objective: "confirm_time", referencedSlotIds: ["slot-a", "slot-x"] }),
      bundle: makeBundle(),
      context: { now: NOW },
    });
    expect(result.allowed).toBe(false);
    const reason = (result as { boundaryReasons: BundleBoundaryReason[] }).boundaryReasons.find(
      (r) => r.type === "slot_not_approved",
    );
    expect(reason).toEqual({ type: "slot_not_approved", slotIds: ["slot-x"] });
  });

  it("ignores slot references for non-slot objectives", () => {
    const result = evaluateDraftAgainstBundle({
      draft: makeDraft({ objective: "follow_up", referencedSlotIds: ["slot-x"] }),
      bundle: makeBundle(),
      context: { now: NOW },
    });
    expect(result).toEqual({ allowed: true });
  });

  it("denies proposed slots dated outside the approved range (local date)", () => {
    // 2026-07-22t01:00z is still 2026-07-21 in new york — inside range
    const inside = makeSlot({ id: "slot-b", startsAt: "2026-07-22T01:00:00.000Z" });
    // 2026-07-22t14:00z is 2026-07-22 local — outside
    const outside = makeSlot({ id: "slot-c", startsAt: "2026-07-22T14:00:00.000Z" });
    const result = evaluateDraftAgainstBundle({
      draft: makeDraft({ referencedSlotIds: ["slot-b", "slot-c"] }),
      bundle: makeBundle(),
      context: { now: NOW, proposedSlots: [inside, outside] },
    });
    expect(result.allowed).toBe(false);
    const reason = (result as { boundaryReasons: BundleBoundaryReason[] }).boundaryReasons.find(
      (r) => r.type === "slot_date_outside_range",
    );
    expect(reason).toEqual({ type: "slot_date_outside_range", slotIds: ["slot-c"] });
  });

  it("denies durations outside the approved range, allows boundary values", () => {
    const bundle = makeBundle({ minimumDurationMinutes: 30, maximumDurationMinutes: 60 });
    const below = evaluateDraftAgainstBundle({
      draft: makeDraft(),
      bundle,
      context: { now: NOW, durationMinutes: 15 },
    });
    expect(reasonTypes(below)).toContain("duration_outside_range");
    const above = evaluateDraftAgainstBundle({
      draft: makeDraft(),
      bundle,
      context: { now: NOW, durationMinutes: 90 },
    });
    expect(reasonTypes(above)).toContain("duration_outside_range");
    const atMax = evaluateDraftAgainstBundle({
      draft: makeDraft(),
      bundle,
      context: { now: NOW, durationMinutes: 60 },
    });
    expect(atMax).toEqual({ allowed: true });
  });

  it("denies when a new attendee is introduced", () => {
    const result = evaluateDraftAgainstBundle({
      draft: makeDraft(),
      bundle: makeBundle({ approvedParticipantIds: ["alex"] }),
      context: { now: NOW, participantIds: ["alex", "jordan"] },
    });
    expect(result.allowed).toBe(false);
    const reason = (result as { boundaryReasons: BundleBoundaryReason[] }).boundaryReasons.find(
      (r) => r.type === "participant_not_approved",
    );
    expect(reason).toEqual({ type: "participant_not_approved", participantIds: ["jordan"] });
  });

  it("denies drafts below the confidence review threshold", () => {
    const result = evaluateDraftAgainstBundle({
      draft: makeDraft({ confidence: 0.69 }),
      bundle: makeBundle(),
      context: { now: NOW },
    });
    expect(reasonTypes(result)).toContain("confidence_below_threshold");
  });

  it("disables bundles entirely for sensitive sessions", () => {
    const result = evaluateDraftAgainstBundle({
      draft: makeDraft(),
      bundle: makeBundle(),
      context: { now: NOW, sensitive: true },
    });
    expect(reasonTypes(result)).toContain("sensitive_session");
  });

  it("denies when the parsed message requires user judgment", () => {
    const result = evaluateDraftAgainstBundle({
      draft: makeDraft(),
      bundle: makeBundle(),
      context: { now: NOW, parsed: makeParsed({ requiresUserJudgment: true }) },
    });
    expect(reasonTypes(result)).toContain("requires_user_judgment");
  });

  it.each(["add_attendee", "reschedule", "cancel", "sensitive", "unrelated", "ambiguous"] as const)(
    "denies on review intent %s",
    (intent) => {
      const result = evaluateDraftAgainstBundle({
        draft: makeDraft(),
        bundle: makeBundle(),
        context: { now: NOW, parsed: makeParsed({ intent }) },
      });
      expect(reasonTypes(result)).toContain("intent_requires_review");
    },
  );

  it("passes through a bundle boundary reason flagged by parsing (purpose change, paid activity)", () => {
    const result = evaluateDraftAgainstBundle({
      draft: makeDraft(),
      bundle: makeBundle(),
      context: {
        now: NOW,
        parsed: makeParsed({ bundleBoundaryReason: "paid activity requires user judgment" }),
      },
    });
    expect(result.allowed).toBe(false);
    expect((result as { boundaryReasons: BundleBoundaryReason[] }).boundaryReasons).toContainEqual({
      type: "boundary_flagged",
      reason: "paid activity requires user judgment",
    });
  });

  it("collects multiple boundary reasons at once", () => {
    const result = evaluateDraftAgainstBundle({
      draft: makeDraft({ objective: "reschedule", confidence: 0.1, referencedSlotIds: [] }),
      bundle: makeBundle({ status: "expired" }),
      context: { now: NOW, sensitive: true },
    });
    expect(reasonTypes(result)).toEqual(
      expect.arrayContaining([
        "sensitive_session",
        "bundle_not_active",
        "objective_not_allowed",
        "confidence_below_threshold",
      ]),
    );
  });

  it("property: an allowed draft is always fully inside the bundle scope", () => {
    const objectives: DraftObjective[] = [
      "propose_slots",
      "ask_for_constraint",
      "ask_for_email",
      "clarify_selection",
      "confirm_time",
      "confirm_invite",
      "follow_up",
      "reschedule",
      "cancel",
    ];
    const bundleObjectives: BundleObjective[] = [
      "propose_slots",
      "ask_for_constraint",
      "ask_for_email",
      "clarify_selection",
      "confirm_time",
      "confirm_invite",
      "follow_up",
    ];
    const slotPool = ["slot-a", "slot-b", "slot-c", "slot-d"];

    fc.assert(
      fc.property(
        fc.record({
          objective: fc.constantFrom(...objectives),
          referencedSlotIds: fc.uniqueArray(fc.constantFrom(...slotPool), { maxLength: 4 }),
          confidence: fc.double({ min: 0, max: 1, noNaN: true }),
          allowedObjectives: fc.uniqueArray(fc.constantFrom(...bundleObjectives), {
            minLength: 1,
            maxLength: 7,
          }),
          approvedSlotIds: fc.uniqueArray(fc.constantFrom(...slotPool), { maxLength: 4 }),
          messagesUsed: fc.integer({ min: 0, max: 4 }),
          expiryOffsetMs: fc.integer({ min: -3_600_000, max: 3_600_000 }),
          sensitive: fc.boolean(),
        }),
        (r) => {
          const bundle = makeBundle({
            allowedObjectives: r.allowedObjectives,
            approvedSlotIds: r.approvedSlotIds,
            messagesUsed: r.messagesUsed,
            expiresAt: new Date(NOW.getTime() + r.expiryOffsetMs).toISOString(),
          });
          const draft = makeDraft({
            objective: r.objective,
            referencedSlotIds: r.referencedSlotIds,
            confidence: r.confidence,
          });
          const result = evaluateDraftAgainstBundle({
            draft,
            bundle,
            context: { now: NOW, sensitive: r.sensitive },
          });
          if (result.allowed) {
            expect(bundle.allowedObjectives).toContain(draft.objective);
            expect(bundle.messagesUsed).toBeLessThan(bundle.maximumOutboundMessages);
            expect(new Date(bundle.expiresAt).getTime()).toBeGreaterThan(NOW.getTime());
            expect(draft.confidence).toBeGreaterThanOrEqual(0.7);
            expect(r.sensitive).toBe(false);
            if (["propose_slots", "confirm_time", "confirm_invite"].includes(draft.objective)) {
              for (const id of draft.referencedSlotIds) {
                expect(bundle.approvedSlotIds).toContain(id);
              }
            }
          }
        },
      ),
    );
  });
});
