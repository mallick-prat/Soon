import { NextResponse } from "next/server";
import { z } from "zod";
import {
  approveDraft,
  enqueueOutboxCommand,
  getDb,
  rejectDraft,
  transitionSessionState,
} from "@soon/database";
import { parseBody, requireDatabase, serverError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("edit"), text: z.string().min(1).max(2000) }),
  z.object({ action: z.literal("reject"), reason: z.string().max(500).optional() }),
  z.object({ action: z.literal("regenerate") }),
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
    const draft = await db.outboundDraft.findUnique({
      where: { id },
      include: { session: true },
    });
    if (!draft) {
      return NextResponse.json({ error: "draft not found" }, { status: 404 });
    }

    switch (data.action) {
      case "approve":
      case "edit": {
        const approved = await approveDraft(id, {
          approvalSource: "dashboard",
          ...(data.action === "edit" && { editedText: data.text }),
        });
        if (data.action === "edit") {
          // capture the edit for style learning
          await db.styleEdit.create({
            data: {
              userId: draft.session.userId,
              sessionId: draft.sessionId,
              draftId: id,
              originalText: draft.text,
              editedText: data.text,
            },
          });
        }
        // hand the message to the mac agent via the outbox
        await enqueueOutboxCommand({
          userId: draft.session.userId,
          sessionId: draft.sessionId,
          commandType: "send_message",
          payloadJson: {
            draftId: id,
            text: data.action === "edit" ? data.text : draft.text,
          },
          idempotencyKey: `send-draft:${id}`,
          expiresAt: draft.expiresAt,
        });
        await transitionSessionState(draft.sessionId, "sending_approved_message", {
          actor: "user",
          reason: data.action === "edit" ? "draft edited and approved" : "draft approved",
        });
        return NextResponse.json({ draft: approved });
      }
      case "reject": {
        const rejected = await rejectDraft(id, data.reason);
        await transitionSessionState(draft.sessionId, "needs_user_input", {
          actor: "user",
          reason: "draft rejected",
        });
        return NextResponse.json({ draft: rejected });
      }
      case "regenerate": {
        // TODO(integration): the scheduling worker (via @soon/scheduling-engine)
        // produces the new draft; the control plane records the request.
        const rejected = await rejectDraft(id, "regenerate requested");
        await transitionSessionState(draft.sessionId, "drafting_proposal", {
          actor: "user",
          reason: "regenerate requested",
        });
        return NextResponse.json({ draft: rejected, regenerating: true });
      }
    }
  } catch {
    return serverError("draft action failed");
  }
}
