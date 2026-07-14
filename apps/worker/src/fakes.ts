import type {
  ActivationContext,
  ApprovalBundle,
  CandidateSlot,
  InterpretedContext,
  OutboundDraft,
  ParsedSchedulingMessage,
  SchedulingSession,
  SchedulingState,
} from "@soon/shared-types";
import { canTransition } from "@soon/scheduling-engine";
import type { AvailabilityService, Clock, CommandDispatcher, Interpreter, SessionStore } from "./ports.js";

/** in-memory test doubles shared by worker tests */

export function makeSession(overrides: Partial<SchedulingSession> = {}): SchedulingSession {
  return {
    id: "session-1",
    userId: "user-1",
    conversationId: "conv-1",
    state: "finding_initial_slots",
    meetingType: "catch_up",
    durationMinutes: 30,
    meetingFormat: "virtual",
    timezone: "America/New_York",
    approvalMode: "approve_every",
    proposalRound: 0,
    outboundMessageCount: 0,
    sensitive: false,
    createdAt: "2026-07-13T16:00:00Z",
    updatedAt: "2026-07-13T16:00:00Z",
    ...overrides,
  };
}

export class FakeStore implements SessionStore {
  sessions = new Map<string, SchedulingSession>();
  slots = new Map<string, CandidateSlot[]>();
  drafts: OutboundDraft[] = [];
  bundles = new Map<string, ApprovalBundle>();
  auditLog: Array<{ sessionId: string; action: string; actor: string }> = [];
  transitions: Array<{ from: SchedulingState; to: SchedulingState }> = [];

  constructor(session: SchedulingSession) {
    this.sessions.set(session.id, session);
  }

  async get(sessionId: string): Promise<SchedulingSession> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`no session ${sessionId}`);
    return s;
  }

  async transition(sessionId: string, to: SchedulingState): Promise<SchedulingSession> {
    const s = await this.get(sessionId);
    if (!canTransition(s.state, to)) {
      throw new Error(`invalid transition ${s.state} -> ${to}`);
    }
    this.transitions.push({ from: s.state, to });
    const next = { ...s, state: to, updatedAt: new Date().toISOString() };
    this.sessions.set(sessionId, next);
    return next;
  }

  async saveCandidateSlots(sessionId: string, slots: CandidateSlot[]): Promise<void> {
    this.slots.set(sessionId, [...(this.slots.get(sessionId) ?? []), ...slots]);
  }

  async markSlotsStatus(sessionId: string, slotIds: string[], status: CandidateSlot["status"]): Promise<void> {
    const list = this.slots.get(sessionId) ?? [];
    for (const slot of list) if (slotIds.includes(slot.id)) slot.status = status;
  }

  async saveDraft(draft: OutboundDraft): Promise<void> {
    this.drafts.push(draft);
  }

  async recordOutbound(): Promise<void> {}

  async getActiveBundle(sessionId: string): Promise<ApprovalBundle | null> {
    return this.bundles.get(sessionId) ?? null;
  }

  async saveBundle(bundle: ApprovalBundle): Promise<void> {
    this.bundles.set(bundle.sessionId, bundle);
  }

  async audit(sessionId: string, action: string, actor: "user" | "soon" | "attendee"): Promise<void> {
    this.auditLog.push({ sessionId, action, actor });
  }
}

export class FakeAvailability implements AvailabilityService {
  busy: Array<{ start: number; end: number }> = [];
  takenSlots = new Set<string>();
  createdEvents: Array<{ idempotencyKey: string; eventId: string }> = [];

  async getBusy(): Promise<Array<{ start: number; end: number }>> {
    return this.busy;
  }

  async slotStillFree(_userId: string, slot: { start: number; end: number }): Promise<boolean> {
    return !this.takenSlots.has(`${slot.start}`);
  }

  async createEvent(input: { idempotencyKey: string }): Promise<{ eventId: string }> {
    const existing = this.createdEvents.find((e) => e.idempotencyKey === input.idempotencyKey);
    if (existing) return { eventId: existing.eventId };
    const eventId = `event-${this.createdEvents.length + 1}`;
    this.createdEvents.push({ idempotencyKey: input.idempotencyKey, eventId });
    return { eventId };
  }
}

export class FakeInterpreter implements Interpreter {
  draftText = "how's tuesday around 3 or thursday morning?";
  draftConfidence = 0.95;
  parsedReply: ParsedSchedulingMessage | null = null;

  async interpretContext(): Promise<InterpretedContext> {
    throw new Error("not used in these tests");
  }

  async interpretReply(): Promise<ParsedSchedulingMessage> {
    if (!this.parsedReply) throw new Error("no scripted reply");
    return this.parsedReply;
  }

  async draft(): Promise<{ text: string; alternatives: string[]; confidence: number }> {
    return { text: this.draftText, alternatives: [], confidence: this.draftConfidence };
  }
}

export class FakeDispatcher implements CommandDispatcher {
  sends: Array<{ draftId: string; text: string; approvalSource: string; idempotencyKey: string }> = [];
  notifications: Array<{ title: string; subtext?: string | undefined }> = [];

  async enqueueSend(input: {
    draftId: string;
    text: string;
    approvalSource: "explicit" | "bundle";
    idempotencyKey: string;
  }): Promise<{ commandId: string }> {
    this.sends.push(input);
    return { commandId: `cmd-${this.sends.length}` };
  }

  async notify(_userId: string, title: string, subtext?: string): Promise<void> {
    this.notifications.push({ title, subtext });
  }
}

export function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso) };
}

export type { ActivationContext };
