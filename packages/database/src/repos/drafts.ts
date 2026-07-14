import { getDb } from "../client.js";
import type { OutboundDraft, Prisma } from "../generated/prisma/client.js";
import type { DraftObjective } from "../generated/prisma/enums.js";

export interface CreateDraftInput {
  sessionId: string;
  objective: DraftObjective;
  text: string;
  alternativeTexts?: string[];
  referencedSlotIds?: string[];
  confidence: number;
  requiresApproval: boolean;
  approvalBundleId?: string;
  expiresAt: Date;
}

/** creates a pending draft; supersedes any other pending drafts on the session */
export async function createDraft(input: CreateDraftInput): Promise<OutboundDraft> {
  const db = getDb();
  return db.$transaction(async (tx) => {
    await tx.outboundDraft.updateMany({
      where: { sessionId: input.sessionId, status: "pending" },
      data: { status: "superseded", approvalState: "expired" },
    });
    return tx.outboundDraft.create({
      data: {
        sessionId: input.sessionId,
        objective: input.objective,
        text: input.text,
        alternativeTexts: (input.alternativeTexts ?? []) as Prisma.InputJsonValue,
        referencedSlotIds: input.referencedSlotIds ?? [],
        confidence: input.confidence,
        requiresApproval: input.requiresApproval,
        expiresAt: input.expiresAt,
        approvalState: input.requiresApproval ? "pending" : "not_required",
        ...(input.approvalBundleId !== undefined && {
          approvalBundleId: input.approvalBundleId,
        }),
      },
    });
  });
}

export interface ApproveDraftOptions {
  /** replacement text — marks the approval as edited_and_approved */
  editedText?: string;
  /** where the approval came from, e.g. "dashboard" | "imessage" | "bundle" */
  approvalSource?: string;
  /** present when the approval was granted by an active bundle */
  approvalBundleId?: string;
}

export async function approveDraft(
  draftId: string,
  options: ApproveDraftOptions = {},
): Promise<OutboundDraft> {
  const db = getDb();
  const approvalState =
    options.editedText !== undefined
      ? "edited_and_approved"
      : options.approvalBundleId !== undefined
        ? "approved_by_bundle"
        : "approved_once";
  return db.outboundDraft.update({
    where: { id: draftId },
    data: {
      status: "approved",
      approvalState,
      approvedAt: new Date(),
      ...(options.editedText !== undefined && { editedText: options.editedText }),
      ...(options.approvalSource !== undefined && {
        approvalSource: options.approvalSource,
      }),
      ...(options.approvalBundleId !== undefined && {
        approvalBundleId: options.approvalBundleId,
      }),
    },
  });
}

export async function rejectDraft(
  draftId: string,
  reason?: string,
): Promise<OutboundDraft> {
  const db = getDb();
  return db.$transaction(async (tx) => {
    const draft = await tx.outboundDraft.update({
      where: { id: draftId },
      data: { status: "rejected", approvalState: "rejected", rejectedAt: new Date() },
    });
    await tx.auditEvent.create({
      data: {
        sessionId: draft.sessionId,
        eventType: "draft_rejected",
        actor: "user",
        detailJson: { draftId, ...(reason !== undefined && { reason }) },
      },
    });
    return draft;
  });
}

/** marks an approved draft as sent (called after the mac acknowledges delivery) */
export async function markDraftSent(draftId: string): Promise<OutboundDraft> {
  const db = getDb();
  return db.outboundDraft.update({
    where: { id: draftId },
    data: { status: "sent", sentAt: new Date() },
  });
}

/**
 * expires every pending/approved draft past its expiry.
 * returns the number of drafts expired. intended for a periodic job.
 */
export async function expireDrafts(now: Date = new Date()): Promise<number> {
  const db = getDb();
  const result = await db.outboundDraft.updateMany({
    where: {
      status: { in: ["pending", "approved"] },
      expiresAt: { lt: now },
    },
    data: { status: "expired", approvalState: "expired" },
  });
  return result.count;
}

/** drafts awaiting review across all of a user's sessions (for /approvals) */
export async function listDraftsAwaitingReview(userId: string) {
  const db = getDb();
  return db.outboundDraft.findMany({
    where: {
      status: "pending",
      requiresApproval: true,
      expiresAt: { gt: new Date() },
      session: { userId },
    },
    include: {
      session: {
        include: {
          conversation: { include: { contact: true } },
          participants: true,
          candidateSlots: { where: { status: { in: ["candidate", "proposed"] } } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}
