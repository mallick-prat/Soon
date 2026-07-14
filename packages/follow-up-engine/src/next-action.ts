import { addDays } from "date-fns";
import type { FollowUpAttempt, FollowUpAttemptStatus, FollowUpPolicy } from "@soon/shared-types";

/** attempts that are still waiting to fire (cancellable) */
const PENDING_STATUSES: ReadonlySet<FollowUpAttemptStatus> = new Set([
  "scheduled",
  "deferred_quiet_hours",
  "awaiting_approval",
  "approved",
]);

/** attempts that already ran their course and count toward the maximum */
const COMPLETED_STATUSES: ReadonlySet<FollowUpAttemptStatus> = new Set([
  "sent",
  "acknowledged",
  "failed",
  "expired",
]);

export type FollowUpNextAction =
  | { kind: "wait"; until: Date }
  | { kind: "due"; attempt: FollowUpAttempt }
  | { kind: "exhausted" }
  | { kind: "session_expired" };

export function nextAction(
  policy: Pick<FollowUpPolicy, "maximumAttempts" | "sessionMaxDays">,
  attempts: readonly FollowUpAttempt[],
  now: Date,
  sessionStartedAt: Date,
): FollowUpNextAction {
  if (now.getTime() > addDays(sessionStartedAt, policy.sessionMaxDays).getTime()) {
    return { kind: "session_expired" };
  }

  // cancelled attempts never count toward the maximum
  const completed = attempts.filter((a) => COMPLETED_STATUSES.has(a.status)).length;
  if (completed >= policy.maximumAttempts) {
    return { kind: "exhausted" };
  }

  const pending = attempts
    .filter((a) => PENDING_STATUSES.has(a.status))
    .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());

  const next = pending[0];
  if (next === undefined) {
    return { kind: "exhausted" };
  }

  const scheduledFor = new Date(next.scheduledFor);
  return scheduledFor.getTime() <= now.getTime()
    ? { kind: "due", attempt: next }
    : { kind: "wait", until: scheduledFor };
}

/** ids of every pending/scheduled attempt whose timer must be cancelled immediately */
export function onReplyReceived(attempts: readonly FollowUpAttempt[]): string[] {
  return attempts.filter((a) => PENDING_STATUSES.has(a.status)).map((a) => a.id);
}
