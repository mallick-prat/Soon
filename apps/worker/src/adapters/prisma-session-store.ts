/**
 * SessionStore port over @soon/database (prisma). the repos return raw prisma
 * rows; this adapter maps them to the @soon/shared-types domain shapes the
 * scheduling engine expects (Date → ISO string, null → undefined) and back.
 *
 * loadFollowUpState is intentionally not implemented here — the follow-up
 * composition (assembling a PreSendSnapshot) is a separate slice, and
 * composition.ts already throws a clear error when it is missing.
 */
import type {
  ApprovalBundle as DomainBundle,
  CandidateSlot as DomainSlot,
  SchedulingSession as DomainSession,
} from "@soon/shared-types";
import {
  getDb,
  transitionSessionState,
  type ApprovalBundle as DbBundle,
  type CandidateSlot as DbSlot,
  type Prisma,
  type SchedulingSession as DbSession,
} from "@soon/database";

import type { SessionStore } from "../ports.js";

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

// ---------------------------------------------------------------- adapter

export function createPrismaSessionStore(): SessionStore {
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
  };
}
