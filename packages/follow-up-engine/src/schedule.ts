import { addHours } from "date-fns";
import type { FollowUpPolicy } from "@soon/shared-types";

export interface PlannedFollowUp {
  attemptNumber: number;
  scheduledFor: Date;
}

export function computeFollowUpSchedule(
  policy: Pick<FollowUpPolicy, "intervalHours" | "maximumAttempts">,
  originalProposalAt: Date,
): PlannedFollowUp[] {
  return policy.intervalHours.slice(0, policy.maximumAttempts).map((hours, index) => ({
    attemptNumber: index + 1,
    scheduledFor: addHours(originalProposalAt, hours),
  }));
}
