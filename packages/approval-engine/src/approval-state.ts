import type { ApprovalState } from "@soon/shared-types";

export type ApprovalAction =
  | "request_approval"
  | "approve"
  | "approve_via_bundle"
  | "edit_and_approve"
  | "reject"
  | "expire";

const TRANSITIONS: Partial<Record<ApprovalState, Partial<Record<ApprovalAction, ApprovalState>>>> = {
  not_required: {
    request_approval: "pending",
    approve_via_bundle: "approved_by_bundle",
  },
  pending: {
    approve: "approved_once",
    approve_via_bundle: "approved_by_bundle",
    edit_and_approve: "edited_and_approved",
    reject: "rejected",
    expire: "expired",
  },
};

/** invalid transitions leave the state unchanged; approved/rejected/expired are terminal */
export function nextApprovalState(current: ApprovalState, action: ApprovalAction): ApprovalState {
  return TRANSITIONS[current]?.[action] ?? current;
}
