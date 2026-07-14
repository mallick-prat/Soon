import { describe, expect, it } from "vitest";
import { BUNDLE_DEFAULTS } from "@soon/shared-types";
import { createBundle, type CreateBundleParams } from "./create-bundle.js";
import { NOW } from "./fixtures.js";

function baseParams(overrides: Partial<CreateBundleParams> = {}): CreateBundleParams {
  return {
    id: "bundle-1",
    sessionId: "session-1",
    allowedObjectives: ["propose_slots", "follow_up"],
    approvedSlotIds: ["slot-a"],
    approvedDateRangeStart: "2026-07-14",
    approvedDateRangeEnd: "2026-07-21",
    minimumDurationMinutes: 30,
    maximumDurationMinutes: 60,
    approvedParticipantIds: ["alex"],
    createdAt: NOW,
    ...overrides,
  };
}

describe("createBundle", () => {
  it("applies hard defaults when caller passes no limits", () => {
    const bundle = createBundle(baseParams());
    expect(bundle.maximumOutboundMessages).toBe(BUNDLE_DEFAULTS.maximumOutboundMessages);
    expect(bundle.expiresAt).toBe(
      new Date(NOW.getTime() + BUNDLE_DEFAULTS.maxAgeHours * 3_600_000).toISOString(),
    );
    expect(bundle.messagesUsed).toBe(0);
    expect(bundle.status).toBe("active");
    expect(bundle.sessionId).toBe("session-1");
  });

  it("clamps requested message limit down to the hard maximum", () => {
    const bundle = createBundle(baseParams({ maximumOutboundMessages: 10 }));
    expect(bundle.maximumOutboundMessages).toBe(BUNDLE_DEFAULTS.maximumOutboundMessages);
  });

  it("keeps a requested message limit below the hard maximum", () => {
    const bundle = createBundle(baseParams({ maximumOutboundMessages: 1 }));
    expect(bundle.maximumOutboundMessages).toBe(1);
  });

  it("clamps a nonsensical message limit up to at least one", () => {
    const bundle = createBundle(baseParams({ maximumOutboundMessages: 0 }));
    expect(bundle.maximumOutboundMessages).toBe(1);
  });

  it("clamps a requested expiry beyond 24h down to 24h", () => {
    const requested = new Date(NOW.getTime() + 72 * 3_600_000);
    const bundle = createBundle(baseParams({ expiresAt: requested }));
    expect(bundle.expiresAt).toBe(new Date(NOW.getTime() + 24 * 3_600_000).toISOString());
  });

  it("keeps a requested expiry earlier than 24h", () => {
    const requested = new Date(NOW.getTime() + 2 * 3_600_000);
    const bundle = createBundle(baseParams({ expiresAt: requested }));
    expect(bundle.expiresAt).toBe(requested.toISOString());
  });

  it("copies scope arrays defensively", () => {
    const slotIds = ["slot-a"];
    const bundle = createBundle(baseParams({ approvedSlotIds: slotIds }));
    slotIds.push("slot-z");
    expect(bundle.approvedSlotIds).toEqual(["slot-a"]);
  });
});
