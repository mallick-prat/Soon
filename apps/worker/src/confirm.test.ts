import { describe, expect, it } from "vitest";
import type { CandidateSlot } from "@soon/shared-types";
import { confirmAndCreateEvent } from "./confirm.js";
import { FakeAvailability, FakeDispatcher, FakeStore, fixedClock, makeSession } from "./fakes.js";

const SLOT: CandidateSlot = {
  id: "slot-a",
  sessionId: "session-1",
  startsAt: "2026-07-22T19:00:00Z",
  endsAt: "2026-07-22T19:30:00Z",
  timezone: "America/New_York",
  status: "accepted",
  score: 5,
  proposalRound: 1,
};

function deps(overrides = {}) {
  const session = makeSession({ state: "interpreting_response", ...overrides });
  const store = new FakeStore(session);
  const availability = new FakeAvailability();
  const dispatcher = new FakeDispatcher();
  return { store, availability, dispatcher, clock: fixedClock("2026-07-20T12:00:00Z"), session };
}

describe("confirmAndCreateEvent", () => {
  it("creates the event, marks the slot booked, and notifies privately", async () => {
    const d = deps();
    await d.store.saveCandidateSlots("session-1", [SLOT], 1);
    const result = await confirmAndCreateEvent(d, d.session, SLOT, { email: "alex@example.com", firstName: "Alex" }, "conv-1");
    expect(result).toEqual({ outcome: "created", eventId: "event-1" });
    expect(d.store.slots.get("session-1")![0]!.status).toBe("booked");
    const note = d.dispatcher.notifications.find((n) => n.title === "scheduled with alex");
    expect(note).toBeDefined();
    expect(note!.subtext).toContain("wed");
    expect((await d.store.get("session-1")).state).toBe("drafting_confirmation");
  });

  it("is idempotent under retry — same idempotency key returns the same event", async () => {
    const d = deps();
    await d.store.saveCandidateSlots("session-1", [SLOT], 1);
    const first = await confirmAndCreateEvent(d, d.session, SLOT, { email: "a@b.co", firstName: "alex" }, "conv-1");
    // simulate a workflow retry: the step re-runs from the pre-confirmation state
    d.store.sessions.set("session-1", { ...(await d.store.get("session-1")), state: "interpreting_response" });
    const again = await confirmAndCreateEvent(
      d,
      await d.store.get("session-1"),
      SLOT,
      { email: "a@b.co", firstName: "alex" },
      "conv-1",
    );
    expect(d.availability.createdEvents).toHaveLength(1);
    expect(again).toEqual(first);
  });

  it("does not create an event when the slot was just taken", async () => {
    const d = deps();
    await d.store.saveCandidateSlots("session-1", [SLOT], 1);
    d.availability.takenSlots.add(`${Date.parse(SLOT.startsAt)}`);
    const result = await confirmAndCreateEvent(d, d.session, SLOT, { email: "a@b.co", firstName: "alex" }, "conv-1");
    expect(result).toEqual({ outcome: "slot_taken" });
    expect(d.availability.createdEvents).toHaveLength(0);
    expect(d.store.slots.get("session-1")![0]!.status).toBe("stale");
    expect((await d.store.get("session-1")).state).toBe("finding_alternative_slots");
  });

  it("uses the generic title for sensitive sessions", async () => {
    const d = deps({ sensitive: true });
    await d.store.saveCandidateSlots("session-1", [SLOT], 1);
    let capturedTitle = "";
    const orig = d.availability.createEvent.bind(d.availability);
    d.availability.createEvent = async (input: { idempotencyKey: string; title?: string }) => {
      capturedTitle = (input as { title: string }).title;
      return orig(input);
    };
    await confirmAndCreateEvent(d, d.session, SLOT, { email: "a@b.co", firstName: "Alex" }, "conv-1");
    expect(capturedTitle).toBe("meeting with alex");
  });
});
