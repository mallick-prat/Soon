import { beforeEach, describe, expect, it, vi } from "vitest";
import pino from "pino";

import type { DeviceEvent } from "@soon/realtime-protocol";

import type { Composition } from "./composition.js";
import { FakeAvailability, FakeDispatcher, FakeInterpreter, FakeStore, fixedClock, makeSession } from "./fakes.js";

// ---------------------------------------------------------------------------
// @soon/database is mocked wholesale: `db` is a mutable bag of prisma-shaped
// fakes each test configures, and the repo helpers are spies.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  const db: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};
  return {
    db,
    approveDraft: vi.fn(async () => ({})),
    rejectDraft: vi.fn(async () => ({})),
    createSessionFromTrigger: vi.fn(),
    findActiveSessionByConversation: vi.fn(),
  };
});

vi.mock("@soon/database", () => ({
  getDb: () => mocks.db,
  approveDraft: mocks.approveDraft,
  rejectDraft: mocks.rejectDraft,
  createSessionFromTrigger: mocks.createSessionFromTrigger,
  findActiveSessionByConversation: mocks.findActiveSessionByConversation,
}));

import { handleDeviceEvent } from "./device-event-handler.js";

const DEVICE_ID = "device-1";
const USER_ID = "user-1";
const SESSION_ID = "session-1";
const CONV_REF = "iMessage;-;+15550000000";

function makeComp(store: FakeStore) {
  const availability = new FakeAvailability();
  const interpreter = new FakeInterpreter();
  const dispatcher = new FakeDispatcher();
  const comp: Composition = {
    store,
    availability,
    interpreter,
    dispatcher,
    clock: fixedClock("2026-07-15T12:00:00.000Z"),
    logger: pino({ level: "silent" }),
    retention: { expireSessionMessageText: async () => 0 },
    runFollowUpTick: async () => ({}),
  };
  return { comp, availability, interpreter, dispatcher };
}

function approvalDecision(
  decision: "send" | "edit" | "another" | "take_over" | "stop",
  editedText?: string,
): DeviceEvent {
  return {
    protocolVersion: 1,
    eventId: "evt-1",
    deviceId: DEVICE_ID,
    sequenceNumber: 1,
    occurredAt: "2026-07-15T12:00:00.000Z",
    idempotencyKey: "idem-1",
    type: "approval_decision",
    payload: { draftId: "draft-1", decision, ...(editedText !== undefined ? { editedText } : {}) },
  } as DeviceEvent;
}

function inboundMessage(text: string, senderIsUser = false): DeviceEvent {
  return {
    protocolVersion: 1,
    eventId: "evt-2",
    deviceId: DEVICE_ID,
    sequenceNumber: 2,
    occurredAt: "2026-07-15T12:00:00.000Z",
    idempotencyKey: "idem-2",
    type: "inbound_message",
    payload: {
      conversationReference: CONV_REF,
      localMessageReference: "msg-1",
      text,
      sentAt: "2026-07-15T12:00:00.000Z",
      senderIsUser,
    },
  } as DeviceEvent;
}

function pendingDraftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    sessionId: SESSION_ID,
    status: "pending",
    text: "how's tuesday at 3?",
    expiresAt: new Date("2026-07-15T18:00:00.000Z"),
    session: {
      userId: USER_ID,
      conversation: { localConversationReference: CONV_REF },
    },
    ...overrides,
  };
}

const slotRow = {
  id: "slot-1",
  sessionId: SESSION_ID,
  startsAt: new Date("2026-07-16T14:00:00.000Z"),
  endsAt: new Date("2026-07-16T14:30:00.000Z"),
  timezone: "America/New_York",
  status: "proposed",
  score: 0.9,
  proposalRound: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mocks.db)) delete mocks.db[key];
  mocks.db["macDevice"] = { findUnique: vi.fn(async () => ({ id: DEVICE_ID, userId: USER_ID })) };
});

describe("handleDeviceEvent · approval_decision", () => {
  it("send: approves the draft, enqueues the real send, lands at waiting_for_attendee", async () => {
    const store = new FakeStore(makeSession({ state: "awaiting_user_approval" }));
    const { comp, dispatcher } = makeComp(store);
    mocks.db["outboundDraft"] = { findUnique: vi.fn(async () => pendingDraftRow()) };

    const outcome = await handleDeviceEvent(approvalDecision("send"), comp);

    expect(outcome).toEqual({ handled: true, sessionId: SESSION_ID, outcome: "sent" });
    expect(mocks.approveDraft).toHaveBeenCalledWith("draft-1", { approvalSource: "imessage" });
    expect(dispatcher.sends).toHaveLength(1);
    expect(dispatcher.sends[0]).toMatchObject({
      draftId: "draft-1",
      text: "how's tuesday at 3?",
      approvalSource: "explicit",
      idempotencyKey: "send:draft-1",
    });
    expect(store.transitions).toEqual([
      { from: "awaiting_user_approval", to: "sending_approved_message" },
      { from: "sending_approved_message", to: "waiting_for_attendee" },
    ]);
  });

  it("edit: the edited text is what actually goes out", async () => {
    const store = new FakeStore(makeSession({ state: "awaiting_user_approval" }));
    const { comp, dispatcher } = makeComp(store);
    mocks.db["outboundDraft"] = { findUnique: vi.fn(async () => pendingDraftRow()) };

    await handleDeviceEvent(approvalDecision("edit", "how about weds at 2 instead?"), comp);

    expect(dispatcher.sends[0]?.text).toBe("how about weds at 2 instead?");
    expect(mocks.approveDraft).toHaveBeenCalledWith("draft-1", {
      approvalSource: "imessage",
      editedText: "how about weds at 2 instead?",
    });
  });

  it("stop: rejects the draft and pauses the session — nothing is sent", async () => {
    const store = new FakeStore(makeSession({ state: "awaiting_user_approval" }));
    const { comp, dispatcher } = makeComp(store);
    mocks.db["outboundDraft"] = { findUnique: vi.fn(async () => pendingDraftRow()) };

    const outcome = await handleDeviceEvent(approvalDecision("stop"), comp);

    expect(outcome.outcome).toBe("stopped");
    expect(mocks.rejectDraft).toHaveBeenCalledWith("draft-1", "user_stopped");
    expect(dispatcher.sends).toHaveLength(0);
    expect(store.transitions).toEqual([{ from: "awaiting_user_approval", to: "paused" }]);
  });

  it("a duplicate decision on a settled draft is a safe no-op", async () => {
    const store = new FakeStore(makeSession({ state: "waiting_for_attendee" }));
    const { comp, dispatcher } = makeComp(store);
    mocks.db["outboundDraft"] = {
      findUnique: vi.fn(async () => pendingDraftRow({ status: "approved" })),
    };

    const outcome = await handleDeviceEvent(approvalDecision("send"), comp);

    expect(outcome.outcome).toBe("already_approved");
    expect(dispatcher.sends).toHaveLength(0);
    expect(store.transitions).toHaveLength(0);
  });

  it("a decision for another user's draft is ignored", async () => {
    const store = new FakeStore(makeSession({ state: "awaiting_user_approval" }));
    const { comp } = makeComp(store);
    mocks.db["outboundDraft"] = {
      findUnique: vi.fn(async () =>
        pendingDraftRow({ session: { userId: "someone-else", conversation: { localConversationReference: CONV_REF } } }),
      ),
    };

    const outcome = await handleDeviceEvent(approvalDecision("send"), comp);
    expect(outcome.handled).toBe(false);
  });
});

describe("handleDeviceEvent · inbound_message", () => {
  function wireInboundDb(participant: Record<string, unknown> | null) {
    mocks.db["conversation"] = { findUnique: vi.fn(async () => ({ id: "conv-1" })) };
    mocks.findActiveSessionByConversation.mockResolvedValue({ id: SESSION_ID });
    mocks.db["sessionMessage"] = {
      upsert: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    };
    mocks.db["candidateSlot"] = { findMany: vi.fn(async () => [slotRow]) };
    mocks.db["outboundDraft"] = {
      findFirst: vi.fn(async () => ({ text: "how's tuesday at 3?", editedText: null })),
    };
    mocks.db["sessionParticipant"] = {
      findFirst: vi.fn(async () => participant),
      update: vi.fn(async () => ({})),
    };
    mocks.db["calendarPreference"] = { findUnique: vi.fn(async () => null) };
  }

  it("accept with a known email: confirms the slot and creates the calendar event", async () => {
    const store = new FakeStore(makeSession({ state: "waiting_for_attendee" }));
    const { comp, availability, interpreter, dispatcher } = makeComp(store);
    wireInboundDb({ id: "p1", email: "sam@example.com", displayName: "Sam Jones" });
    interpreter.parsedReply = {
      intent: "accept_slot",
      acceptedSlotId: "slot-1",
      confidence: 0.95,
      requiresUserJudgment: false,
    };

    const outcome = await handleDeviceEvent(inboundMessage("tuesday works!"), comp);

    expect(outcome).toEqual({ handled: true, sessionId: SESSION_ID, outcome: "scheduled" });
    expect(availability.createdEvents).toHaveLength(1);
    expect(store.sessions.get(SESSION_ID)?.state).toBe("scheduled");
    // the private "scheduled with sam" notification fired
    expect(dispatcher.notifications.some((n) => n.title.includes("sam"))).toBe(true);
  });

  it("accept without an email: parks at waiting_for_email and remembers the slot", async () => {
    const store = new FakeStore(makeSession({ state: "waiting_for_attendee" }));
    const { comp, interpreter, dispatcher } = makeComp(store);
    wireInboundDb({ id: "p1", email: null, displayName: "Sam Jones" });
    interpreter.parsedReply = {
      intent: "accept_slot",
      acceptedSlotId: "slot-1",
      confidence: 0.95,
      requiresUserJudgment: false,
    };

    const outcome = await handleDeviceEvent(inboundMessage("tuesday works!"), comp);

    expect(outcome.outcome).toBe("waiting_for_email");
    expect(store.sessions.get(SESSION_ID)?.state).toBe("waiting_for_email");
    expect(dispatcher.notifications.some((n) => n.title.includes("email"))).toBe(true);
  });

  it("a rejection runs a fresh proposal round", async () => {
    const store = new FakeStore(makeSession({ state: "waiting_for_attendee" }));
    const { comp, interpreter, dispatcher } = makeComp(store);
    wireInboundDb({ id: "p1", email: "sam@example.com", displayName: "Sam" });
    interpreter.parsedReply = {
      intent: "reject_slots",
      confidence: 0.9,
      requiresUserJudgment: false,
      availabilityConstraints: { earliestDate: "2026-07-20" },
    };

    const outcome = await handleDeviceEvent(inboundMessage("none of those work sorry"), comp);

    // new round drafted and parked for approval (no active bundle)
    expect(outcome.outcome).toBe("awaiting_approval");
    expect(dispatcher.approvalRequests).toHaveLength(1);
    expect(store.sessions.get(SESSION_ID)?.state).toBe("awaiting_user_approval");
    // rejected slots are never re-offered: none of the fresh candidates is slot-1's time
    const fresh = store.slots.get(SESSION_ID) ?? [];
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((s) => s.startsAt !== slotRow.startsAt.toISOString())).toBe(true);
    // and the attendee's "not before the 20th" constraint held
    expect(fresh.every((s) => Date.parse(s.startsAt) >= Date.parse("2026-07-20"))).toBe(true);
  });

  it("a low-confidence reply pauses for the user instead of guessing", async () => {
    const store = new FakeStore(makeSession({ state: "waiting_for_attendee" }));
    const { comp, interpreter, dispatcher } = makeComp(store);
    wireInboundDb({ id: "p1", email: "sam@example.com", displayName: "Sam" });
    interpreter.parsedReply = {
      intent: "accept_slot",
      acceptedSlotId: "slot-1",
      confidence: 0.4,
      requiresUserJudgment: false,
    };

    const outcome = await handleDeviceEvent(inboundMessage("maybe? idk what week even is this"), comp);

    expect(outcome.outcome).toBe("needs_user_input");
    expect(store.sessions.get(SESSION_ID)?.state).toBe("needs_user_input");
    expect(dispatcher.notifications.some((n) => n.title.includes("needs you"))).toBe(true);
  });

  it("an unrelated message is consumed without advancing the machine", async () => {
    const store = new FakeStore(makeSession({ state: "waiting_for_attendee" }));
    const { comp, interpreter } = makeComp(store);
    wireInboundDb({ id: "p1", email: "sam@example.com", displayName: "Sam" });
    interpreter.parsedReply = {
      intent: "unrelated",
      confidence: 0.9,
      requiresUserJudgment: false,
    };

    const outcome = await handleDeviceEvent(inboundMessage("lol did you see the game"), comp);

    expect(outcome.outcome).toBe("ignored");
    expect(store.sessions.get(SESSION_ID)?.state).toBe("waiting_for_attendee");
  });

  it("the user's own messages never drive the machine", async () => {
    const store = new FakeStore(makeSession({ state: "waiting_for_attendee" }));
    const { comp } = makeComp(store);

    const outcome = await handleDeviceEvent(inboundMessage("i'll just text them myself", true), comp);
    expect(outcome.handled).toBe(false);
  });

  it("a reply landing on a parked session is recorded but not routed", async () => {
    const store = new FakeStore(makeSession({ state: "needs_user_input" }));
    const { comp, interpreter } = makeComp(store);
    wireInboundDb({ id: "p1", email: "sam@example.com", displayName: "Sam" });
    interpreter.parsedReply = {
      intent: "accept_slot",
      acceptedSlotId: "slot-1",
      confidence: 0.95,
      requiresUserJudgment: false,
    };

    const outcome = await handleDeviceEvent(inboundMessage("tuesday works!"), comp);

    expect(outcome.outcome).toBe("recorded_only");
    // the message was persisted…
    expect(mocks.db["sessionMessage"]?.["upsert"]).toHaveBeenCalled();
    // …but the machine did not move.
    expect(store.transitions).toHaveLength(0);
    expect(store.sessions.get(SESSION_ID)?.state).toBe("needs_user_input");
  });

  it("a message with no active session is ignored", async () => {
    const store = new FakeStore(makeSession({ state: "waiting_for_attendee" }));
    const { comp } = makeComp(store);
    mocks.db["conversation"] = { findUnique: vi.fn(async () => ({ id: "conv-1" })) };
    mocks.findActiveSessionByConversation.mockResolvedValue(null);

    const outcome = await handleDeviceEvent(inboundMessage("hey"), comp);
    expect(outcome.handled).toBe(false);
  });
});
