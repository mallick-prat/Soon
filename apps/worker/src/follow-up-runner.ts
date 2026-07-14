import { randomUUID } from "node:crypto";
import type { FollowUpAttempt, FollowUpPolicy, SchedulingSession } from "@soon/shared-types";
import {
  adjustForSendWindow,
  evaluatePreSendChecklist,
  nextAction,
  type PreSendSnapshot,
} from "@soon/follow-up-engine";
import type { Clock, CommandDispatcher, Interpreter, SessionStore } from "./ports.js";
import { meetingContextFor } from "./approval-request.js";

export type FollowUpDeps = {
  store: SessionStore;
  interpreter: Interpreter;
  dispatcher: CommandDispatcher;
  clock: Clock;
};

export type FollowUpTickResult =
  | { kind: "wait"; until: Date }
  | { kind: "sent"; attemptNumber: number }
  | { kind: "blocked"; blockers: string[] }
  | { kind: "awaiting_approval" }
  | { kind: "exhausted" }
  | { kind: "session_expired" };

/**
 * one wake-up of the durable follow-up loop. the workflow engine persists the
 * wait; this function decides what the wake-up does. every send is preceded by
 * the full pre-send checklist and covered by an idempotency key.
 */
export async function runFollowUpTick(
  deps: FollowUpDeps,
  session: SchedulingSession,
  policy: FollowUpPolicy,
  attempts: FollowUpAttempt[],
  snapshot: Omit<PreSendSnapshot, "now">,
  conversationReference: string,
  styleExamples: string[],
): Promise<FollowUpTickResult> {
  const now = deps.clock.now();
  const sessionStartedAt = new Date(session.createdAt);

  const decision = nextAction(policy, attempts, now, sessionStartedAt);
  if (decision.kind === "session_expired") {
    await deps.store.transition(session.id, "needs_user_input", { reason: "session_max_age" });
    await deps.dispatcher.notify(session.userId, "still unscheduled", "this one has been open a while", [
      "review",
      "close",
    ]);
    return { kind: "session_expired" };
  }
  if (decision.kind === "exhausted") {
    await deps.store.transition(session.id, "follow_up_sequence_exhausted");
    await deps.dispatcher.notify(session.userId, "keep trying?", undefined, [
      "send another",
      "snooze",
      "close",
    ]);
    return { kind: "exhausted" };
  }
  if (decision.kind === "wait") {
    const adjusted = adjustForSendWindow(
      decision.until,
      policy.quietHours,
      policy.weekendsEnabled,
      policy.quietHours.timezone,
    );
    return { kind: "wait", until: adjusted };
  }

  // due — run the checklist against a fresh snapshot before anything leaves
  const check = evaluatePreSendChecklist({ ...snapshot, now });
  if (!check.ok) {
    await deps.store.audit(session.id, "follow_up_blocked", "soon", { blockers: check.blockers });
    return { kind: "blocked", blockers: check.blockers.map(String) };
  }

  await deps.store.transition(session.id, "drafting_follow_up");
  const drafted = await deps.interpreter.draft({
    sessionId: session.id,
    objective: "follow_up",
    slots: [],
    styleExamples,
  });

  const draftId = randomUUID();
  await deps.store.saveDraft({
    id: draftId,
    sessionId: session.id,
    objective: "follow_up",
    text: drafted.text,
    alternativeTexts: drafted.alternatives,
    referencedSlotIds: [],
    confidence: drafted.confidence,
    requiresApproval: policy.requiresApproval,
    ...(policy.approvalBundleId ? { approvalBundleId: policy.approvalBundleId } : {}),
    expiresAt: new Date(now.getTime() + 12 * 3_600_000).toISOString(),
  });

  if (policy.requiresApproval) {
    await deps.store.transition(session.id, "awaiting_follow_up_approval");
    await deps.dispatcher.enqueueApprovalRequest({
      userId: session.userId,
      sessionId: session.id,
      conversationReference,
      draftId,
      text: drafted.text,
      meetingContext: meetingContextFor(session),
      candidateTimes: [],
      whySelected: "",
      bundleStatus: { mode: "approve_every" },
      idempotencyKey: `approve:${draftId}`,
      expiresAtIso: new Date(now.getTime() + 12 * 3_600_000).toISOString(),
    });
    return { kind: "awaiting_approval" };
  }

  await deps.store.transition(session.id, "sending_follow_up", { approvalSource: "bundle" });
  await deps.dispatcher.enqueueSend({
    userId: session.userId,
    sessionId: session.id,
    conversationReference,
    draftId,
    text: drafted.text,
    approvalSource: "bundle",
    idempotencyKey: decision.attempt.idempotencyKey,
    expiresAtIso: new Date(now.getTime() + 12 * 3_600_000).toISOString(),
  });
  await deps.store.audit(session.id, "follow_up_sent_via_bundle", "soon", {
    attemptNumber: decision.attempt.attemptNumber,
  });
  return { kind: "sent", attemptNumber: decision.attempt.attemptNumber };
}
