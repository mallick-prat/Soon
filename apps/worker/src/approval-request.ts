/**
 * helpers for building the request_approval command payload — shared by the
 * proposal and follow-up producers so the mac approval window always receives
 * consistent, protocol-shaped draft detail.
 */
import { formatSlotLabel } from "@soon/agent";
import type { ApprovalBundle, CandidateSlot, SchedulingSession } from "@soon/shared-types";
import type { BundleStatus, CandidateTime } from "@soon/realtime-protocol";

/** format candidate slots into the labels the mac approval window renders. */
export function candidateTimesFrom(slots: CandidateSlot[]): CandidateTime[] {
  return slots.map((slot) => ({ slotId: slot.id, label: formatSlotLabel(slot) }));
}

/** short human meeting description shown above the proposed message. */
export function meetingContextFor(session: SchedulingSession): string {
  return session.title ?? session.meetingType.replace(/_/g, " ");
}

/** the approval mode in effect for this draft, for the window's status line. */
export function bundleStatusFor(bundle: ApprovalBundle | null): BundleStatus {
  if (!bundle || bundle.status !== "active") return { mode: "approve_every" };
  return {
    mode: "bundle",
    messagesUsed: bundle.messagesUsed,
    maximumOutboundMessages: bundle.maximumOutboundMessages,
    expiresAt: bundle.expiresAt,
  };
}
