import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, revokeBundle, snoozeSession, transitionSessionState } from "@soon/database";
import { parseBody, requireDatabase, serverError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

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
        // TODO(integration): @soon/approval-engine approves + enqueues the
        // outbox command; for now just fast-forward the next action time.
        const updated = await db.schedulingSession.update({
          where: { id },
          data: { nextActionAt: new Date() },
        });
        return NextResponse.json({ session: updated });
      }
      case "edit_next_follow_up": {
        // TODO(integration): @soon/follow-up-engine should recompute the
        // attempt schedule; the control plane just persists intent.
        const updated = await db.schedulingSession.update({
          where: { id },
          data: {
            nextActionAt: new Date(data.nextAtIso),
            nextActionType: "send_follow_up",
          },
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
        // TODO(integration): @soon/follow-up-engine reschedules pending attempts.
        const policy = await db.followUpPolicy.update({
          where: { id: session.followUpPolicyId },
          data: { intervalHours: data.intervalHours },
        });
        return NextResponse.json({ policy });
      }
    }
  } catch {
    return serverError("action failed");
  }
}
