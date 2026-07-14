import { describe, expect, it } from "vitest";
import { consumeBundleMessage, expireBundleIf } from "./lifecycle.js";
import { NOW, makeBundle } from "./fixtures.js";

describe("consumeBundleMessage", () => {
  it("increments messagesUsed without mutating the input", () => {
    const bundle = makeBundle();
    const next = consumeBundleMessage(bundle);
    expect(next.messagesUsed).toBe(1);
    expect(next.status).toBe("active");
    expect(bundle.messagesUsed).toBe(0);
    expect(next).not.toBe(bundle);
  });

  it("flips status to consumed at the limit", () => {
    const bundle = makeBundle({ messagesUsed: 2, maximumOutboundMessages: 3 });
    const next = consumeBundleMessage(bundle);
    expect(next.messagesUsed).toBe(3);
    expect(next.status).toBe("consumed");
  });

  it("consumes to exhaustion across repeated calls", () => {
    let bundle = makeBundle({ maximumOutboundMessages: 3 });
    bundle = consumeBundleMessage(bundle);
    bundle = consumeBundleMessage(bundle);
    expect(bundle.status).toBe("active");
    bundle = consumeBundleMessage(bundle);
    expect(bundle.status).toBe("consumed");
    // further calls never exceed the cap
    bundle = consumeBundleMessage(bundle);
    expect(bundle.messagesUsed).toBe(3);
    expect(bundle.status).toBe("consumed");
  });
});

describe("expireBundleIf", () => {
  it("revokes on event_created", () => {
    expect(expireBundleIf(makeBundle(), { type: "event_created" }).status).toBe("revoked");
  });

  it("revokes on session_cancelled", () => {
    expect(expireBundleIf(makeBundle(), { type: "session_cancelled" }).status).toBe("revoked");
  });

  it("revokes on user_takeover", () => {
    expect(expireBundleIf(makeBundle(), { type: "user_takeover" }).status).toBe("revoked");
  });

  it("expires on time_passed once past expiresAt", () => {
    const bundle = makeBundle({ expiresAt: NOW.toISOString() });
    expect(expireBundleIf(bundle, { type: "time_passed", now: NOW }).status).toBe("expired");
  });

  it("leaves an unexpired bundle untouched on time_passed", () => {
    const bundle = makeBundle({ expiresAt: new Date(NOW.getTime() + 1000).toISOString() });
    const next = expireBundleIf(bundle, { type: "time_passed", now: NOW });
    expect(next).toBe(bundle);
  });

  it("terminal statuses take precedence — never resurrected or re-labelled", () => {
    const consumed = makeBundle({ status: "consumed" });
    expect(expireBundleIf(consumed, { type: "user_takeover" })).toBe(consumed);
    const revoked = makeBundle({ status: "revoked" });
    expect(expireBundleIf(revoked, { type: "time_passed", now: NOW })).toBe(revoked);
  });
});
