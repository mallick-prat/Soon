import { getDb } from "../client.js";
import type { ApprovalBundle } from "../generated/prisma/client.js";
import type { BundleObjective } from "../generated/prisma/enums.js";

/** hard product defaults, mirroring BUNDLE_DEFAULTS in @soon/shared-types */
export const BUNDLE_DEFAULTS = {
  maximumOutboundMessages: 3,
  maxAgeHours: 24,
} as const;

export interface CreateBundleInput {
  sessionId: string;
  allowedObjectives: BundleObjective[];
  approvedSlotIds?: string[];
  approvedDateRangeStart: Date;
  approvedDateRangeEnd: Date;
  minimumDurationMinutes: number;
  maximumDurationMinutes: number;
  approvedParticipantIds?: string[];
  maximumOutboundMessages?: number;
  expiresAt?: Date;
}

/**
 * creates an active approval bundle, revokes any previously-active bundle on
 * the session, and points the session's active_approval_bundle_id at it.
 */
export async function createBundle(input: CreateBundleInput): Promise<ApprovalBundle> {
  const db = getDb();
  const expiresAt =
    input.expiresAt ??
    new Date(Date.now() + BUNDLE_DEFAULTS.maxAgeHours * 60 * 60 * 1000);
  return db.$transaction(async (tx) => {
    await tx.approvalBundle.updateMany({
      where: { sessionId: input.sessionId, status: "active" },
      data: { status: "revoked" },
    });
    const bundle = await tx.approvalBundle.create({
      data: {
        sessionId: input.sessionId,
        allowedObjectives: input.allowedObjectives,
        approvedSlotIds: input.approvedSlotIds ?? [],
        approvedDateRangeStart: input.approvedDateRangeStart,
        approvedDateRangeEnd: input.approvedDateRangeEnd,
        minimumDurationMinutes: input.minimumDurationMinutes,
        maximumDurationMinutes: input.maximumDurationMinutes,
        approvedParticipantIds: input.approvedParticipantIds ?? [],
        maximumOutboundMessages:
          input.maximumOutboundMessages ?? BUNDLE_DEFAULTS.maximumOutboundMessages,
        expiresAt,
        status: "active",
      },
    });
    await tx.schedulingSession.update({
      where: { id: input.sessionId },
      data: { activeApprovalBundleId: bundle.id },
    });
    await tx.auditEvent.create({
      data: {
        sessionId: input.sessionId,
        eventType: "bundle_created",
        actor: "user",
        detailJson: {
          bundleId: bundle.id,
          allowedObjectives: input.allowedObjectives,
          expiresAt: expiresAt.toISOString(),
        },
      },
    });
    return bundle;
  });
}

export interface ConsumeBundleResult {
  allowed: boolean;
  reason?: "expired" | "exhausted" | "revoked" | "consumed" | "objective_not_allowed";
  bundle: ApprovalBundle;
}

/**
 * atomically consumes one outbound message from an active bundle.
 * marks the bundle consumed when its message budget is used up, or expired
 * when past its expiry. never over-consumes.
 */
export async function consumeBundleMessage(
  bundleId: string,
  objective?: BundleObjective,
): Promise<ConsumeBundleResult> {
  const db = getDb();
  return db.$transaction(async (tx) => {
    const bundle = await tx.approvalBundle.findUniqueOrThrow({
      where: { id: bundleId },
    });
    if (bundle.status !== "active") {
      return {
        allowed: false,
        reason: bundle.status === "expired" ? "expired" : bundle.status,
        bundle,
      } as ConsumeBundleResult;
    }
    if (bundle.expiresAt < new Date()) {
      const expired = await tx.approvalBundle.update({
        where: { id: bundleId },
        data: { status: "expired" },
      });
      return { allowed: false, reason: "expired", bundle: expired };
    }
    if (objective !== undefined && !bundle.allowedObjectives.includes(objective)) {
      return { allowed: false, reason: "objective_not_allowed", bundle };
    }
    if (bundle.messagesUsed >= bundle.maximumOutboundMessages) {
      const consumed = await tx.approvalBundle.update({
        where: { id: bundleId },
        data: { status: "consumed" },
      });
      return { allowed: false, reason: "exhausted", bundle: consumed };
    }
    const nextUsed = bundle.messagesUsed + 1;
    const updated = await tx.approvalBundle.update({
      where: { id: bundleId },
      data: {
        messagesUsed: nextUsed,
        ...(nextUsed >= bundle.maximumOutboundMessages && { status: "consumed" as const }),
      },
    });
    return { allowed: true, bundle: updated };
  });
}

/** revokes a bundle (user pressed "stop" / took over) */
export async function revokeBundle(bundleId: string): Promise<ApprovalBundle> {
  const db = getDb();
  return db.$transaction(async (tx) => {
    const bundle = await tx.approvalBundle.update({
      where: { id: bundleId },
      data: { status: "revoked" },
    });
    await tx.schedulingSession.updateMany({
      where: { id: bundle.sessionId, activeApprovalBundleId: bundleId },
      data: { activeApprovalBundleId: null },
    });
    return bundle;
  });
}
