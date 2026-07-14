import { getDb } from "../client.js";
import type { Prisma, SchedulingSession } from "../generated/prisma/client.js";
import { SchedulingState } from "../generated/prisma/enums.js";
import type {
  ActorType,
  ApprovalMode,
  MeetingFormat,
  MeetingType,
  WaitingOn,
} from "../generated/prisma/enums.js";

/**
 * mirrors UNRESOLVED_STATES in @soon/shared-types: every state except
 * scheduled / expired / failed / cancelling still shows in "upcoming".
 */
export const RESOLVED_SESSION_STATES = [
  SchedulingState.scheduled,
  SchedulingState.expired,
  SchedulingState.failed,
  SchedulingState.cancelling,
] as const;

export const UNRESOLVED_SESSION_STATES: SchedulingState[] = Object.values(
  SchedulingState,
).filter((s) => !(RESOLVED_SESSION_STATES as readonly SchedulingState[]).includes(s));

export const TERMINAL_SESSION_STATES = [
  SchedulingState.scheduled,
  SchedulingState.expired,
  SchedulingState.failed,
] as const;

export interface CreateSessionFromTriggerInput {
  userId: string;
  conversationId: string;
  triggerMessageReference: string;
  timezone: string;
  meetingType?: MeetingType;
  durationMinutes?: number;
  meetingFormat?: MeetingFormat;
  title?: string;
  approvalMode?: ApprovalMode;
  sensitive?: boolean;
}

/**
 * creates a session in the `triggered` state from a mac-agent activation,
 * recording a `session_triggered` audit event in the same transaction.
 */
export async function createSessionFromTrigger(
  input: CreateSessionFromTriggerInput,
): Promise<SchedulingSession> {
  const db = getDb();
  return db.$transaction(async (tx) => {
    const session = await tx.schedulingSession.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId,
        triggerMessageReference: input.triggerMessageReference,
        timezone: input.timezone,
        state: SchedulingState.triggered,
        ...(input.meetingType !== undefined && { meetingType: input.meetingType }),
        ...(input.durationMinutes !== undefined && {
          durationMinutes: input.durationMinutes,
        }),
        ...(input.meetingFormat !== undefined && { meetingFormat: input.meetingFormat }),
        ...(input.title !== undefined && { title: input.title }),
        ...(input.approvalMode !== undefined && { approvalMode: input.approvalMode }),
        ...(input.sensitive !== undefined && { sensitive: input.sensitive }),
      },
    });
    await tx.auditEvent.create({
      data: {
        userId: input.userId,
        sessionId: session.id,
        eventType: "session_triggered",
        actor: "mac_agent",
        toState: SchedulingState.triggered,
        detailJson: { triggerMessageReference: input.triggerMessageReference },
      },
    });
    return session;
  });
}

function isPlainObject(v: unknown): v is Record<string, Prisma.InputJsonValue> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface TransitionOptions {
  actor?: ActorType;
  reason?: string;
  detail?: Prisma.InputJsonValue;
  /** extra columns to persist alongside the state change */
  patch?: Prisma.SchedulingSessionUpdateInput;
}

/**
 * transitions a session to a new state, persisting an audit event
 * (event_type `state_transition`) in the same transaction. terminal
 * states also stamp completed_at.
 */
export async function transitionSessionState(
  sessionId: string,
  toState: SchedulingState,
  options: TransitionOptions = {},
): Promise<SchedulingSession> {
  const db = getDb();
  return db.$transaction(async (tx) => {
    const existing = await tx.schedulingSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { id: true, userId: true, state: true },
    });
    const isTerminal = (
      TERMINAL_SESSION_STATES as readonly SchedulingState[]
    ).includes(toState);
    const session = await tx.schedulingSession.update({
      where: { id: sessionId },
      data: {
        state: toState,
        ...(isTerminal && { completedAt: new Date() }),
        ...(options.reason !== undefined && { resolvedReason: options.reason }),
        ...options.patch,
      },
    });
    const detailJson: Prisma.InputJsonValue | undefined =
      options.reason !== undefined
        ? { reason: options.reason, ...(isPlainObject(options.detail) ? options.detail : {}) }
        : options.detail;
    await tx.auditEvent.create({
      data: {
        userId: existing.userId,
        sessionId,
        eventType: "state_transition",
        actor: options.actor ?? "system",
        fromState: existing.state,
        toState,
        ...(detailJson !== undefined && { detailJson }),
      },
    });
    return session;
  });
}

/** most recent unresolved session for a conversation, if any */
export async function findActiveSessionByConversation(
  conversationId: string,
): Promise<SchedulingSession | null> {
  const db = getDb();
  return db.schedulingSession.findFirst({
    where: {
      conversationId,
      state: { in: UNRESOLVED_SESSION_STATES },
    },
    orderBy: { createdAt: "desc" },
  });
}

/** convenience: snooze a session until a given instant (audited) */
export async function snoozeSession(
  sessionId: string,
  until: Date,
  actor: ActorType = "user",
): Promise<SchedulingSession> {
  const db = getDb();
  return db.$transaction(async (tx) => {
    const session = await tx.schedulingSession.update({
      where: { id: sessionId },
      data: { snoozedUntil: until },
    });
    await tx.auditEvent.create({
      data: {
        userId: session.userId,
        sessionId,
        eventType: "session_snoozed",
        actor,
        detailJson: { until: until.toISOString() },
      },
    });
    return session;
  });
}
