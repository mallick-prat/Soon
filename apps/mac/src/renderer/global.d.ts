import type { ApprovalDecision, ApprovalRequest } from "../approvals/types.js";

declare global {
  interface Window {
    soon: {
      getApprovalPayload(): Promise<ApprovalRequest | undefined>;
      decide(decision: ApprovalDecision): void;
      onPayload(cb: (payload: ApprovalRequest) => void): () => void;
    };
  }
}

export {};
