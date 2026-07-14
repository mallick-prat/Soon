import { describe, expect, it } from "vitest";
import { APPROVAL_STATES } from "@soon/shared-types";
import { nextApprovalState, type ApprovalAction } from "./approval-state.js";

describe("nextApprovalState", () => {
  it("moves not_required to pending on request_approval", () => {
    expect(nextApprovalState("not_required", "request_approval")).toBe("pending");
  });

  it("allows bundle approval directly from not_required", () => {
    expect(nextApprovalState("not_required", "approve_via_bundle")).toBe("approved_by_bundle");
  });

  it("resolves pending via each approval path", () => {
    expect(nextApprovalState("pending", "approve")).toBe("approved_once");
    expect(nextApprovalState("pending", "approve_via_bundle")).toBe("approved_by_bundle");
    expect(nextApprovalState("pending", "edit_and_approve")).toBe("edited_and_approved");
  });

  it("rejects and expires from pending", () => {
    expect(nextApprovalState("pending", "reject")).toBe("rejected");
    expect(nextApprovalState("pending", "expire")).toBe("expired");
  });

  it("treats resolved states as terminal for every action", () => {
    const actions: ApprovalAction[] = [
      "request_approval",
      "approve",
      "approve_via_bundle",
      "edit_and_approve",
      "reject",
      "expire",
    ];
    const terminal = APPROVAL_STATES.filter((s) => s !== "not_required" && s !== "pending");
    for (const state of terminal) {
      for (const action of actions) {
        expect(nextApprovalState(state, action)).toBe(state);
      }
    }
  });
});
