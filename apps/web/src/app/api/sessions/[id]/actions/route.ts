import { NextResponse } from "next/server";
import { z } from "zod";
import {
  approveDraft,
  enqueueOutboxCommand,
  getDb,
  revokeBundle,
  snoozeSession,
  transitionSessionState,
} from "@soon/database";
import { adjustForSendWindow, computeFollowUpSchedule } from "@soon/follow-up-engine";
import { parseBody, requireDatabase, serverError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/** parse a FollowUpPolicy.quietHoursJson value defensively, with prd defaults. */
function readQuietHours(value: unknown): { earliest: string; latest: string } {
  const v = (value ?? {}) as Record<string, unknown>;
  return {
    earliest: typeof v.earliest === "string" ? v.earliest : "09:00",
    latest: typeof v.latest === "string" ? v.latest : "19:00",
  };
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("cancel"), reason: z.string().max(500).optional() }),
  z.object({ action: z.literal("take_over") }),
  z.object({
    action: z.literal("close"),
    reason: z.enum(["scheduled_elsewhere", "no_longer_needed", "other"]).default("other"),
  }),
  z.object({ action: z.literal("snooze"), untilIso: z.iso.datetime() }),
  z.object({ action: z.literal("send_now"), draftId: z.string().optional() }),
  z.object({
    action: z.literal("edit_next_follow_up"),
    nextAtIso: z.iso.datetime(),
  }),
  z.object({
    action: z.literal("change_cadence"),
    intervalHours: z.array(z.number().positive()).min(1).max(5),
  }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;
  const { id } = await context.params;
  const { data, error } = await parseBody(request, actionSchema);
  if (error) return error;

  try {
    const db = getDb();
    const session = await db.schedulingSession.findUnique({ where: { id } });
    if (!session) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

    switch (data.action) {
      case "pause": {
        const updated = await transitionSessionState(id, "paused", { actor: "user" });
        if (session.activeApprovalBundleId) {
          await revokeBundle(session.activeApprovalBundleId);
        }
        return NextResponse.json({ session: updated });
      }
      case "resume": {
        const updated = await transitionSessionState(id, "waiting_for_attendee", {
          actor: "user",
          reason: "resumed from dashboard",
          patch: { snoozedUntil: null },
        });
        return NextResponse.json({ session: updated });
      }
      case "cancel": {
        const updated = await transitionSessionState(id, "cancelling", {
          actor: "user",
          ...(data.reason !== undefined && { reason: data.reason }),
        });
        return NextResponse.json({ session: updated });
      }
      case "take_over": {
        const updated = await transitionSessionState(id, "taken_over", {
          actor: "user",
          reason: "user took over the conversation",
        });
        if (session.activeApprovalBundleId) {
          await revokeBundle(session.activeApprovalBundleId);
        }
        return NextResponse.json({ session: updated });
      }
      case "close": {
        const updated = await transitionSessionState(id, "expired", {
          actor: "user",
          reason: data.reason,
        });
        return NextResponse.json({ session: updated });
      }
      case "snooze": {
        const updated = await snoozeSession(id, new Date(data.untilIso));
        return NextResponse.json({ session: updated });
      }
      case "send_now": {
        // explicit user approval: approve the pending draft and hand it to the
        // mac via the outbox — the same path as a dashboard draft approval.
        const draft = data.draftId
          ? await db.outboundDraft.findUnique({ where: { id: data.draftId } })
          : await db.outboundDraft.findFirst({
              where: { sessionId: id, status: "pending" },
              orderBy: { createdAt: "desc" },
            });
        if (!draft || draft.sessionId !== id) {
          return NextResponse.json({ error: "no draft to send" }, { status: 409 });
        }
        await approveDraft(draft.id, { approvalSource: "dashboard" });
        await enqueueOutboxCommand({
          userId: session.userId,
          sessionId: id,
          commandType: "send_message",
          payloadJson: { draftId: draft.id, text: draft.text },
          idempotencyKey: `send-draft:${draft.id}`,
          expiresAt: draft.expiresAt,
        });
        const updated = await transitionSessionState(id, "sending_approved_message", {
          actor: "user",
          reason: "sent from dashboard",
        });
        return NextResponse.json({ session: updated, draftId: draft.id });
      }
      case "edit_next_follow_up": {
        // honor the user's chosen time, but snap it into the contact's allowed
        // send window (quiet hours / weekend rules) via @soon/follow-up-engine.
        const requested = new Date(data.nextAtIso);
        const policy = session.followUpPolicyId
          ? await db.followUpPolicy.findUnique({
              where: { id: session.followUpPolicyId },
            })
          : null;
        const nextActionAt = policy
          ? adjustForSendWindow(
              requested,
              readQuietHours(policy.quietHoursJson),
              policy.weekendsEnabled,
              session.timezone,
            )
          : requested;
        const updated = await db.schedulingSession.update({
          where: { id },
          data: { nextActionAt, nextActionType: "send_follow_up" },
        });
        return NextResponse.json({ session: updated });
      }
      case "change_cadence": {
        if (!session.followUpPolicyId) {
          return NextResponse.json(
            { error: "session has no follow-up policy" },
            { status: 409 },
          );
        }
        const policy = await db.followUpPolicy.update({
          where: { id: session.followUpPolicyId },
          data: { intervalHours: data.intervalHours },
        });
        // recompute the next follow-up from the new cadence (anchored at now,
        // i.e. the change applies going forward) and snap it into the send
        // window. only touches sessions actively waiting on a follow-up.
        let updatedSession = session;
        if (session.nextActionAt) {
          const [firstAttempt] = computeFollowUpSchedule(
            { intervalHours: data.intervalHours, maximumAttempts: policy.maximumAttempts },
            new Date(),
          );
          if (firstAttempt) {
            updatedSession = await db.schedulingSession.update({
              where: { id },
              data: {
                nextActionAt: adjustForSendWindow(
                  firstAttempt.scheduledFor,
                  readQuietHours(policy.quietHoursJson),
                  policy.weekendsEnabled,
                  session.timezone,
                ),
                nextActionType: "send_follow_up",
              },
            });
          }
        }
        return NextResponse.json({ policy, session: updatedSession });
      }
    }
  } catch {
    return serverError("action failed");
  }
}
