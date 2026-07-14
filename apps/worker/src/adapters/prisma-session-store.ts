/**
 * SessionStore port over @soon/database (prisma). the repos return raw prisma
 * rows; this adapter maps them to the @soon/shared-types domain shapes the
 * scheduling engine expects (Date → ISO string, null → undefined) and back.
 *
 * it also implements loadFollowUpState — the extension the follow-up runner
 * resolves through composition.ts — assembling the domain policy, attempts, and
 * a pre-send snapshot from persisted state.
 */
import type {
  ApprovalBundle as DomainBundle,
  CandidateSlot as DomainSlot,
  FollowUpAttempt as DomainAttempt,
  FollowUpPolicy as DomainPolicy,
  SchedulingSession as DomainSession,
} from "@soon/shared-types";
import type { PreSendSnapshot } from "@soon/follow-up-engine";
import {
  getDb,
  transitionSessionState,
  type ApprovalBundle as DbBundle,
  type CandidateSlot as DbSlot,
  type FollowUpAttempt as DbAttempt,
  type FollowUpPolicy as DbPolicy,
  type Prisma,
  type SchedulingSession as DbSession,
} from "@soon/database";

import type { SessionStore } from "../ports.js";

/** the follow-up runner resolves this extension through composition.ts. */
export interface FollowUpStateLoader {
  loadFollowUpState(sessionId: string): Promise<{
    policy: DomainPolicy;
    attempts: DomainAttempt[];
    snapshot: Omit<PreSendSnapshot, "now">;
    styleExamples: string[];
  }>;
}

/** session states in which a follow-up must NOT fire. */
const FOLLOW_UP_INACTIVE_STATES = new Set([
  "paused",
  "taken_over",
  "cancelling",
  "scheduled",
  "expired",
  "failed",
]);

const DEFAULT_MINIMUM_NOTICE_MINUTES = 120;

// ---------------------------------------------------------------- mappers

export function toDomainSession(r: DbSession): DomainSession {
  return {
    id: r.id,
    userId: r.userId,
    conversationId: r.conversationId,
    state: r.state,
    meetingType: r.meetingType,
    ...(r.title !== null ? { title: r.title } : {}),
    durationMinutes: r.durationMinutes,
    meetingFormat: r.meetingFormat,
    ...(r.location !== null ? { location: r.location } : {}),
    timezone: r.timezone,
    ...(r.dateRangeStart !== null ? { dateRangeStart: r.dateRangeStart.toISOString() } : {}),
    ...(r.dateRangeEnd !== null ? { dateRangeEnd: r.dateRangeEnd.toISOString() } : {}),
    ...(r.calendarEventId !== null ? { calendarEventId: r.calendarEventId } : {}),
    approvalMode: r.approvalMode,
    ...(r.activeApprovalBundleId !== null
      ? { activeApprovalBundleId: r.activeApprovalBundleId }
      : {}),
    proposalRound: r.proposalRound,
    outboundMessageCount: r.outboundMessageCount,
    ...(r.waitingOn !== null ? { waitingOn: r.waitingOn } : {}),
    ...(r.nextActionAt !== null ? { nextActionAt: r.nextActionAt.toISOString() } : {}),
    ...(r.nextActionType !== null ? { nextActionType: r.nextActionType } : {}),
    sensitive: r.sensitive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toDomainSlot(r: DbSlot): DomainSlot {
  return {
    id: r.id,
    sessionId: r.sessionId,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    timezone: r.timezone,
    status: r.status,
    score: r.score,
    proposalRound: r.proposalRound,
  };
}

export function toDomainBundle(r: DbBundle): DomainBundle {
  return {
    id: r.id,
    sessionId: r.sessionId,
    allowedObjectives: r.allowedObjectives,
    approvedSlotIds: r.approvedSlotIds,
    approvedDateRangeStart: r.approvedDateRangeStart.toISOString(),
    approvedDateRangeEnd: r.approvedDateRangeEnd.toISOString(),
    minimumDurationMinutes: r.minimumDurationMinutes,
    maximumDurationMinutes: r.maximumDurationMinutes,
    approvedParticipantIds: r.approvedParticipantIds,
    maximumOutboundMessages: r.maximumOutboundMessages,
    messagesUsed: r.messagesUsed,
    expiresAt: r.expiresAt.toISOString(),
    status: r.status,
  };
}

/** parse a FollowUpPolicy.quietHoursJson value defensively, with prd defaults. */
function readQuietHours(value: unknown): { earliest: string; latest: string } {
  const v = (value ?? {}) as Record<string, unknown>;
  return {
    earliest: typeof v.earliest === "string" ? v.earliest : "09:00",
    latest: typeof v.latest === "string" ? v.latest : "19:00",
  };
}

/** intervalHours is stored as json; coerce to a positive-number array with a default. */
function readIntervalHours(value: unknown): number[] {
  if (Array.isArray(value)) {
    const hours = value.filter((h): h is number => typeof h === "number" && h > 0);
    if (hours.length > 0) return hours;
  }
  return [48, 120, 240];
}

export function toDomainFollowUpPolicy(
  r: DbPolicy,
  sessionId: string,
  timezone: string,
): DomainPolicy {
  return {
    id: r.id,
    sessionId: r.sessionId ?? sessionId,
    enabled: r.enabled,
    mode: r.mode,
    intervalHours: readIntervalHours(r.intervalHours),
    maximumAttempts: r.maximumAttempts,
    sessionMaxDays: r.sessionMaxDays,
    quietHours: { ...readQuietHours(r.quietHoursJson), timezone },
    weekendsEnabled: r.weekendsEnabled,
    requiresApproval: r.requiresApproval,
    ...(r.approvalBundleId !== null ? { approvalBundleId: r.approvalBundleId } : {}),
  };
}

export function toDomainFollowUpAttempt(r: DbAttempt): DomainAttempt {
  return {
    id: r.id,
    sessionId: r.sessionId,
    policyId: r.policyId,
    attemptNumber: r.attemptNumber,
    scheduledFor: r.scheduledFor.toISOString(),
    ...(r.sendWindowStart !== null ? { sendWindowStart: r.sendWindowStart.toISOString() } : {}),
    ...(r.sendWindowEnd !== null ? { sendWindowEnd: r.sendWindowEnd.toISOString() } : {}),
    status: r.status,
    ...(r.draftId !== null ? { draftId: r.draftId } : {}),
    idempotencyKey: r.idempotencyKey,
  };
}

export interface PreSendSnapshotInputs {
  sessionState: string;
  timezone: string;
  lastOutboundAt: Date | null;
  updatedAt: Date;
  lastInboundAt: Date | null;
  policy: DomainPolicy;
  bundle: DomainBundle | undefined;
  referencedSlotStarts: readonly Date[];
  minimumNoticeMinutes: number;
}

/**
 * assemble the pre-send checklist snapshot from persisted state. signals soon
 * does not yet track (a manual user reply, an explicit decline / opt-out, the
 * conversation moving on) default to non-blocking — the checks that CAN be
 * derived (session active, new inbound, bundle validity, quiet hours, stale
 * candidates) are all enforced.
 */
export function buildPreSendSnapshot(input: PreSendSnapshotInputs): Omit<PreSendSnapshot, "now"> {
  return {
    sessionActive: !FOLLOW_UP_INACTIVE_STATES.has(input.sessionState),
    lastActionAt: input.lastOutboundAt ?? input.updatedAt,
    ...(input.lastInboundAt !== null ? { lastInboundAt: input.lastInboundAt } : {}),
    // a follow-up auto-send (approval not required) must be covered by a bundle.
    requiresBundle: !input.policy.requiresApproval,
    ...(input.bundle !== undefined ? { bundle: input.bundle } : {}),
    quietHours: {
      earliest: input.policy.quietHours.earliest,
      latest: input.policy.quietHours.latest,
    },
    weekendsEnabled: input.policy.weekendsEnabled,
    timezone: input.timezone,
    attendeeDeclined: false,
    attendeeOptedOut: false,
    referencedSlotStarts: input.referencedSlotStarts,
    minimumNoticeMinutes: input.minimumNoticeMinutes,
    conversationMovedOn: false,
  };
}

// ---------------------------------------------------------------- adapter

export function createPrismaSessionStore(): SessionStore & FollowUpStateLoader {
  return {
    async get(sessionId) {
      const row = await getDb().schedulingSession.findUniqueOrThrow({ where: { id: sessionId } });
      return toDomainSession(row);
    },

    async transition(sessionId, to, metadata) {
      const options: Parameters<typeof transitionSessionState>[2] = { actor: "system" };
      if (metadata !== undefined && typeof metadata["reason"] === "string") {
        options.reason = metadata["reason"];
      }
      if (metadata !== undefined) options.detail = metadata as Prisma.InputJsonValue;
      const row = await transitionSessionState(sessionId, to, options);
      return toDomainSession(row);
    },

    async saveCandidateSlots(sessionId, slots, proposalRound) {
      await getDb().candidateSlot.createMany({
        data: slots.map((s) => ({
          id: s.id,
          sessionId,
          startsAt: new Date(s.startsAt),
          endsAt: new Date(s.endsAt),
          timezone: s.timezone,
          status: s.status,
          score: s.score,
          proposalRound,
        })),
      });
    },

    async markSlotsStatus(sessionId, slotIds, status) {
      await getDb().candidateSlot.updateMany({
        where: { sessionId, id: { in: slotIds } },
        data: { status },
      });
    },

    async saveDraft(draft) {
      const db = getDb();
      await db.$transaction(async (tx) => {
        // one pending draft per session — supersede any prior one.
        await tx.outboundDraft.updateMany({
          where: { sessionId: draft.sessionId, status: "pending" },
          data: { status: "superseded", approvalState: "expired" },
        });
        await tx.outboundDraft.create({
          data: {
            id: draft.id,
            sessionId: draft.sessionId,
            objective: draft.objective,
            text: draft.text,
            alternativeTexts: draft.alternativeTexts,
            referencedSlotIds: draft.referencedSlotIds,
            confidence: draft.confidence,
            requiresApproval: draft.requiresApproval,
            approvalState: draft.requiresApproval ? "pending" : "not_required",
            ...(draft.approvalBundleId !== undefined
              ? { approvalBundleId: draft.approvalBundleId }
              : {}),
            expiresAt: new Date(draft.expiresAt),
          },
        });
      });
    },

    async recordOutbound(sessionId) {
      await getDb().schedulingSession.update({
        where: { id: sessionId },
        data: { outboundMessageCount: { increment: 1 }, lastOutboundAt: new Date() },
      });
    },

    async getActiveBundle(sessionId) {
      const row = await getDb().approvalBundle.findFirst({
        where: { sessionId, status: "active" },
        orderBy: { createdAt: "desc" },
      });
      return row !== null ? toDomainBundle(row) : null;
    },

    async saveBundle(bundle) {
      await getDb().approvalBundle.upsert({
        where: { id: bundle.id },
        update: { status: bundle.status, messagesUsed: bundle.messagesUsed },
        create: {
          id: bundle.id,
          sessionId: bundle.sessionId,
          allowedObjectives: bundle.allowedObjectives,
          approvedSlotIds: bundle.approvedSlotIds,
          approvedDateRangeStart: new Date(bundle.approvedDateRangeStart),
          approvedDateRangeEnd: new Date(bundle.approvedDateRangeEnd),
          minimumDurationMinutes: bundle.minimumDurationMinutes,
          maximumDurationMinutes: bundle.maximumDurationMinutes,
          approvedParticipantIds: bundle.approvedParticipantIds,
          maximumOutboundMessages: bundle.maximumOutboundMessages,
          messagesUsed: bundle.messagesUsed,
          expiresAt: new Date(bundle.expiresAt),
          status: bundle.status,
        },
      });
    },

    async audit(sessionId, action, actor, metadata) {
      await getDb().auditEvent.create({
        data: {
          sessionId,
          eventType: action,
          actor: actor === "soon" ? "system" : actor,
          ...(metadata !== undefined ? { detailJson: metadata as Prisma.InputJsonValue } : {}),
        },
      });
    },

    async loadFollowUpState(sessionId) {
      const db = getDb();
      const session = await db.schedulingSession.findUniqueOrThrow({ where: { id: sessionId } });
      if (session.followUpPolicyId === null) {
        throw new Error(`session ${sessionId} has no follow-up policy`);
      }
      const [policyRow, attemptRows, slots, bundleRow, calendarPref] = await Promise.all([
        db.followUpPolicy.findUniqueOrThrow({ where: { id: session.followUpPolicyId } }),
        db.followUpAttempt.findMany({ where: { sessionId }, orderBy: { attemptNumber: "asc" } }),
        db.candidateSlot.findMany({
          where: { sessionId, status: { in: ["candidate", "proposed"] } },
        }),
        db.approvalBundle.findFirst({
          where: { sessionId, status: "active" },
          orderBy: { createdAt: "desc" },
        }),
        db.calendarPreference.findUnique({ where: { userId: session.userId } }),
      ]);

      const policy = toDomainFollowUpPolicy(policyRow, sessionId, session.timezone);
      const bundle = bundleRow !== null ? toDomainBundle(bundleRow) : undefined;
      const snapshot = buildPreSendSnapshot({
        sessionState: session.state,
        timezone: session.timezone,
        lastOutboundAt: session.lastOutboundAt,
        updatedAt: session.updatedAt,
        lastInboundAt: session.lastInboundAt,
        policy,
        bundle,
        referencedSlotStarts: slots.map((s) => s.startsAt),
        minimumNoticeMinutes:
          calendarPref?.minimumNoticeMinutes ?? DEFAULT_MINIMUM_NOTICE_MINUTES,
      });

      return {
        policy,
        attempts: attemptRows.map(toDomainFollowUpAttempt),
        snapshot,
        // style retrieval for follow-ups is a later refinement; the drafter
        // falls back to concise defaults with no examples.
        styleExamples: [],
      };
    },
  };
}
