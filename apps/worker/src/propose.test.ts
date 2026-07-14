import { describe, expect, it } from "vitest";
import { createBundle } from "@soon/approval-engine";
import type { WorkingHours } from "@soon/shared-types";
import { runProposalRound } from "./propose.js";
import { FakeAvailability, FakeDispatcher, FakeInterpreter, FakeStore, fixedClock, makeSession } from "./fakes.js";

const TZ = "America/New_York";
const WORKDAYS: WorkingHours[] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "18:00" }));

function deps(session = makeSession()) {
  const store = new FakeStore(session);
  const availability = new FakeAvailability();
  const interpreter = new FakeInterpreter();
  const dispatcher = new FakeDispatcher();
  const clock = fixedClock("2026-07-17T16:00:00Z");
  return { store, availability, interpreter, dispatcher, clock, session };
}

const GEN_INPUT = {
  rangeStart: new Date("2026-07-20T04:00:00Z"),
  rangeEnd: new Date("2026-07-24T20:00:00Z"),
  durationMinutes: 30,
  timezone: TZ,
  workingHours: WORKDAYS,
};

describe("runProposalRound", () => {
  it("parks a draft for approval in approve-every mode", async () => {
    const d = deps();
    const result = await runProposalRound(d, d.session, GEN_INPUT, [], "conv-ref");
    expect(result.outcome).toBe("awaiting_approval");
    expect(result.slots.length).toBe(3);
    expect(d.store.drafts).toHaveLength(1);
    expect(d.store.drafts[0]!.requiresApproval).toBe(true);
    expect(d.dispatcher.sends).toHaveLength(0);
    // the full draft is dispatched to the mac for local approval.
    expect(d.dispatcher.approvalRequests).toHaveLength(1);
    expect(d.dispatcher.approvalRequests[0]!.text).toBe(d.store.drafts[0]!.text);
    expect(d.dispatcher.approvalRequests[0]!.candidateTimes).toHaveLength(3);
    expect((await d.store.get("session-1")).state).toBe("awaiting_user_approval");
  });

  it("auto-sends inside a valid bundle and records the audit source", async () => {
    const d = deps();
    // hack: the bundle must approve the generated slot ids, which are random.
    // approve by date-range instead: bundle covering the whole window with
    // approvedSlotIds empty means slot-id checks fail — so instead pre-approve
    // after generation by evaluating what the engine would produce. simplest
    // honest path: wide bundle with the propose objective and matching dates,
    // and patch approvedSlotIds afterward via the store's saved slots.
    const store = d.store;
    const origSave = store.saveCandidateSlots.bind(store);
    store.saveCandidateSlots = async (sessionId, slots, round) => {
      await origSave(sessionId, slots, round as never);
      const bundle = createBundle({
        id: "bundle-1",
        sessionId: "session-1",
        allowedObjectives: ["propose_slots", "ask_for_email", "confirm_invite"],
        approvedSlotIds: slots.map((s) => s.id),
        approvedDateRangeStart: "2026-07-19",
        approvedDateRangeEnd: "2026-07-25",
        minimumDurationMinutes: 15,
        maximumDurationMinutes: 60,
        approvedParticipantIds: ["contact-1"],
        createdAt: new Date("2026-07-17T15:00:00Z"),
      });
      await store.saveBundle(bundle);
    };

    const result = await runProposalRound(d, d.session, GEN_INPUT, [], "conv-ref");
    expect(result.outcome).toBe("sent");
    expect(d.dispatcher.sends).toHaveLength(1);
    expect(d.dispatcher.sends[0]!.approvalSource).toBe("bundle");
    expect(d.store.auditLog.some((a) => a.action === "outbound_sent_via_bundle")).toBe(true);
  });

  it("never auto-sends for a sensitive session even with a bundle", async () => {
    const session = makeSession({ sensitive: true });
    const d = deps(session);
    const bundle = createBundle({
      id: "bundle-1",
      sessionId: "session-1",
      allowedObjectives: ["propose_slots"],
      approvedSlotIds: [],
      approvedDateRangeStart: "2026-07-19",
      approvedDateRangeEnd: "2026-07-25",
      minimumDurationMinutes: 15,
      maximumDurationMinutes: 60,
      approvedParticipantIds: [],
      createdAt: new Date("2026-07-17T15:00:00Z"),
    });
    await d.store.saveBundle(bundle);
    const result = await runProposalRound(d, d.session, GEN_INPUT, [], "conv-ref");
    expect(result.outcome).toBe("awaiting_approval");
    expect(d.dispatcher.sends).toHaveLength(0);
  });

  it("pauses privately when the calendar is full", async () => {
    const d = deps();
    d.availability.busy = [
      { start: Date.parse("2026-07-19T00:00:00Z"), end: Date.parse("2026-07-26T00:00:00Z") },
    ];
    const result = await runProposalRound(d, d.session, GEN_INPUT, [], "conv-ref");
    expect(result.outcome).toBe("no_slots");
    expect(d.dispatcher.notifications.some((n) => n.title === "couldn't land this one")).toBe(true);
    expect((await d.store.get("session-1")).state).toBe("needs_user_input");
    expect(d.dispatcher.sends).toHaveLength(0);
  });
});
