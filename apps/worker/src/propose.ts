import { randomUUID } from "node:crypto";
import type { CandidateSlot, OutboundDraft, SchedulingSession } from "@soon/shared-types";
import { generateCandidateSlots, type SlotGenerationInput } from "@soon/scheduling-engine";
import { evaluateDraftAgainstBundle } from "@soon/approval-engine";
import type { AvailabilityService, Clock, CommandDispatcher, Interpreter, SessionStore } from "./ports.js";

export type ProposeDeps = {
  store: SessionStore;
  availability: AvailabilityService;
  interpreter: Interpreter;
  dispatcher: CommandDispatcher;
  clock: Clock;
};

const DRAFT_TTL_MS = 6 * 3_600_000;

/**
 * one proposal round: fresh busy data → deterministic candidates → llm draft
 * → bundle check → either auto-send or park in awaiting_user_approval.
 * every step is idempotent; the caller (durable workflow) may retry it.
 */
export async function runProposalRound(
  deps: ProposeDeps,
  session: SchedulingSession,
  input: Omit<SlotGenerationInput, "busy" | "now">,
  styleExamples: string[],
  conversationReference: string,
): Promise<{ outcome: "sent" | "awaiting_approval" | "no_slots"; slots: CandidateSlot[] }> {
  const now = deps.clock.now();
  const busy = await deps.availability.getBusy(
    session.userId,
    input.rangeStart.toISOString(),
    input.rangeEnd.toISOString(),
  );

  const generated = generateCandidateSlots({ ...input, busy, now });
  if (generated.length === 0) {
    await deps.store.transition(session.id, "needs_user_input", { reason: "no_available_slots" });
    await deps.dispatcher.notify(
      session.userId,
      "couldn't land this one",
      "your calendar has no room in the discussed window",
      ["review", "take over", "stop"],
    );
    return { outcome: "no_slots", slots: [] };
  }

  const round = session.proposalRound + 1;
  const slots: CandidateSlot[] = generated.map((s) => ({
    id: randomUUID(),
    sessionId: session.id,
    startsAt: new Date(s.start).toISOString(),
    endsAt: new Date(s.end).toISOString(),
    timezone: s.timezone,
    status: "candidate",
    score: s.score,
    proposalRound: round,
  }));
  await deps.store.saveCandidateSlots(session.id, slots, round);

  await deps.store.transition(session.id, "drafting_proposal");
  const drafted = await deps.interpreter.draft({
    sessionId: session.id,
    objective: "propose_slots",
    slots,
    styleExamples,
  });

  const draft: OutboundDraft = {
    id: randomUUID(),
    sessionId: session.id,
    objective: "propose_slots",
    text: drafted.text,
    alternativeTexts: drafted.alternatives,
    referencedSlotIds: slots.map((s) => s.id),
    confidence: drafted.confidence,
    requiresApproval: true,
    expiresAt: new Date(now.getTime() + DRAFT_TTL_MS).toISOString(),
  };

  const bundle = await deps.store.getActiveBundle(session.id);
  if (bundle && !session.sensitive) {
    const verdict = evaluateDraftAgainstBundle({
      draft,
      bundle,
      context: {
        now,
        proposedSlots: slots,
        durationMinutes: session.durationMinutes,
        sensitive: session.sensitive,
      },
    });
    if (verdict.allowed) {
      draft.requiresApproval = false;
      draft.approvalBundleId = bundle.id;
    }
  }

  await deps.store.saveDraft(draft);

  if (!draft.requiresApproval && draft.approvalBundleId) {
    await deps.store.transition(session.id, "sending_approved_message", { approvalSource: "bundle" });
    await deps.dispatcher.enqueueSend({
      userId: session.userId,
      sessionId: session.id,
      conversationReference,
      draftId: draft.id,
      text: draft.text,
      approvalSource: "bundle",
      idempotencyKey: `send:${draft.id}`,
      expiresAtIso: draft.expiresAt,
    });
    await deps.store.audit(session.id, "outbound_sent_via_bundle", "soon", { draftId: draft.id });
    return { outcome: "sent", slots };
  }

  await deps.store.transition(session.id, "awaiting_user_approval");
  await deps.dispatcher.notify(session.userId, "soon is handling this", "draft ready to review", [
    "review",
    "stop",
  ]);
  return { outcome: "awaiting_approval", slots };
}
