import { addMinutes } from "date-fns";
import type { ApprovalBundle, QuietHours } from "@soon/shared-types";
import { adjustForSendWindow } from "./send-window.js";

export type PreSendBlocker =
  | "session_not_active"
  | "new_inbound_since_last_action"
  | "user_replied_manually"
  | "bundle_invalid"
  | "outside_allowed_hours"
  | "attendee_declined"
  | "attendee_opted_out"
  | "candidate_times_stale"
  | "conversation_moved_on";

/** point-in-time snapshot the orchestrator assembles right before a send */
export interface PreSendSnapshot {
  now: Date;
  sessionActive: boolean;
  /** when the engine last acted on this session */
  lastActionAt: Date;
  /** most recent inbound attendee message, if any */
  lastInboundAt?: Date;
  /** most recent message the user sent manually in the thread, if any */
  lastManualUserReplyAt?: Date;
  /** whether this send must be covered by a bundle */
  requiresBundle: boolean;
  bundle?: ApprovalBundle;
  quietHours: Pick<QuietHours, "earliest" | "latest">;
  weekendsEnabled: boolean;
  timezone: string;
  attendeeDeclined: boolean;
  attendeeOptedOut: boolean;
  /** start instants of every slot the outgoing message references */
  referencedSlotStarts: readonly Date[];
  minimumNoticeMinutes: number;
  conversationMovedOn: boolean;
}

export type PreSendResult = { ok: true } | { ok: false; blockers: PreSendBlocker[] };

export function evaluatePreSendChecklist(input: PreSendSnapshot): PreSendResult {
  const blockers: PreSendBlocker[] = [];

  if (!input.sessionActive) {
    blockers.push("session_not_active");
  }
  if (
    input.lastInboundAt !== undefined &&
    input.lastInboundAt.getTime() > input.lastActionAt.getTime()
  ) {
    blockers.push("new_inbound_since_last_action");
  }
  if (
    input.lastManualUserReplyAt !== undefined &&
    input.lastManualUserReplyAt.getTime() > input.lastActionAt.getTime()
  ) {
    blockers.push("user_replied_manually");
  }
  if (input.requiresBundle) {
    const bundle = input.bundle;
    const bundleUsable =
      bundle !== undefined &&
      bundle.status === "active" &&
      input.now.getTime() < new Date(bundle.expiresAt).getTime() &&
      bundle.messagesUsed < bundle.maximumOutboundMessages;
    if (!bundleUsable) {
      blockers.push("bundle_invalid");
    }
  }
  const adjusted = adjustForSendWindow(
    input.now,
    input.quietHours,
    input.weekendsEnabled,
    input.timezone,
  );
  if (adjusted.getTime() !== input.now.getTime()) {
    blockers.push("outside_allowed_hours");
  }
  if (input.attendeeDeclined) {
    blockers.push("attendee_declined");
  }
  if (input.attendeeOptedOut) {
    blockers.push("attendee_opted_out");
  }
  const staleBefore = addMinutes(input.now, input.minimumNoticeMinutes);
  if (input.referencedSlotStarts.some((start) => start.getTime() < staleBefore.getTime())) {
    blockers.push("candidate_times_stale");
  }
  if (input.conversationMovedOn) {
    blockers.push("conversation_moved_on");
  }

  return blockers.length === 0 ? { ok: true } : { ok: false, blockers };
}
