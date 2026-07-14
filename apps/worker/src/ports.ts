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
import type { BundleStatus, CandidateTime } from "@soon/realtime-protocol";

/**
 * ports the orchestrator depends on. adapters (prisma repos, realtime gateway
 * client, @soon/agent llm calls, @soon/calendar) are wired at composition time
 * so workflow steps stay replay-safe and unit-testable.
 */

export type SessionStore = {
  get(sessionId: string): Promise<SchedulingSession>;
  transition(sessionId: string, to: SchedulingState, metadata?: Record<string, unknown>): Promise<SchedulingSession>;
  saveCandidateSlots(sessionId: string, slots: CandidateSlot[], proposalRound: number): Promise<void>;
  markSlotsStatus(sessionId: string, slotIds: string[], status: CandidateSlot["status"]): Promise<void>;
  saveDraft(draft: OutboundDraft): Promise<void>;
  recordOutbound(sessionId: string, draftId: string): Promise<void>;
  getActiveBundle(sessionId: string): Promise<ApprovalBundle | null>;
  saveBundle(bundle: ApprovalBundle): Promise<void>;
  audit(sessionId: string, action: string, actor: "user" | "soon" | "attendee", metadata?: Record<string, unknown>): Promise<void>;
};

export type AvailabilityService = {
  /** busy intervals across blocking calendars, epoch ms */
  getBusy(userId: string, timeMinIso: string, timeMaxIso: string): Promise<Array<{ start: number; end: number }>>;
  /** revalidate a specific slot immediately before booking */
  slotStillFree(userId: string, slot: { start: number; end: number }): Promise<boolean>;
  createEvent(input: {
    userId: string;
    sessionId: string;
    conversationId: string;
    idempotencyKey: string;
    startIso: string;
    endIso: string;
    timezone: string;
    attendeeEmail: string;
    title: string;
    location?: string | undefined;
    wantsMeet: boolean;
  }): Promise<{ eventId: string; htmlLink?: string | undefined }>;
};

export type Interpreter = {
  interpretContext(ctx: ActivationContext): Promise<InterpretedContext>;
  interpretReply(input: {
    sessionId: string;
    replyText: string;
    proposedSlots: CandidateSlot[];
    lastOutboundText: string;
  }): Promise<ParsedSchedulingMessage>;
  draft(input: {
    sessionId: string;
    objective: OutboundDraft["objective"];
    slots: CandidateSlot[];
    styleExamples: string[];
    priorText?: string | undefined;
  }): Promise<{ text: string; alternatives: string[]; confidence: number }>;
};

export type CommandDispatcher = {
  /** enqueue a signed send_message command to the user's mac; resolves when persisted (not delivered) */
  enqueueSend(input: {
    userId: string;
    sessionId: string;
    conversationReference: string;
    draftId: string;
    text: string;
    approvalSource: "explicit" | "bundle";
    idempotencyKey: string;
    expiresAtIso: string;
  }): Promise<{ commandId: string }>;
  /**
   * enqueue a request_approval command carrying the full draft so the mac
   * shows its private approval window. the user's choice returns as an
   * approval_decision device event; the cloud then issues the actual send.
   * resolves when persisted (not delivered).
   */
  enqueueApprovalRequest(input: {
    userId: string;
    sessionId: string;
    conversationReference: string;
    draftId: string;
    text: string;
    meetingContext: string;
    candidateTimes: CandidateTime[];
    whySelected: string;
    bundleStatus: BundleStatus;
    idempotencyKey: string;
    expiresAtIso: string;
  }): Promise<{ commandId: string }>;
  notify(userId: string, title: string, subtext?: string, actions?: string[]): Promise<void>;
};

export type Clock = { now(): Date };
