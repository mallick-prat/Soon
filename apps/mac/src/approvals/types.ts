/** approval window contract shared by main, preload, and renderer. */

export interface CandidateTime {
  slotId: string;
  /** human label, e.g. "tue 2:00–2:30 pm". */
  label: string;
}

export type BundleStatus =
  | { mode: "approve_every" }
  | { mode: "bundle"; messagesUsed: number; maximumOutboundMessages: number; expiresAt: string }
  | { mode: "calendar_only" };

export interface ApprovalRequest {
  draftId: string;
  conversationRef: string;
  /** the exact message soon proposes to send. */
  proposedText: string;
  /** short description of the meeting being scheduled. */
  meetingContext: string;
  candidateTimes: CandidateTime[];
  /** why these times were selected. */
  whySelected: string;
  bundleStatus: BundleStatus;
  /** ISO instant after which this draft must not be sent. */
  expiresAt: string;
}

export type ApprovalDecisionKind = "send" | "edit" | "another" | "take_over" | "stop";

export interface ApprovalDecision {
  draftId: string;
  decision: ApprovalDecisionKind;
  editedText?: string;
}

/** ipc channel allowlist — preload refuses everything else. */
export const IPC_CHANNELS = {
  getApprovalPayload: "soon:approval:get-payload",
  approvalDecision: "soon:approval:decision",
  approvalPayloadPush: "soon:approval:payload",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
