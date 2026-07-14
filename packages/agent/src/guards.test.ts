import { CONFIDENCE_REVIEW_THRESHOLD, type ParsedSchedulingMessage } from "@soon/shared-types";
import { describe, expect, it } from "vitest";
import {
  applyReplyGuards,
  isBareAcceptance,
  normalizeEmail,
  type InterpretReplyInput,
} from "./interpret-reply.js";

function acceptParse(overrides: Partial<ParsedSchedulingMessage> = {}): ParsedSchedulingMessage {
  return {
    intent: "accept_slot",
    acceptedSlotId: "s1",
    confidence: 0.95,
    requiresUserJudgment: false,
    ...overrides,
  };
}

function input(overrides: Partial<InterpretReplyInput> = {}): InterpretReplyInput {
  return {
    replyText: "tuesday works",
    recentMessages: [],
    proposedSlots: [
      { id: "s1", label: "tuesday july 21 at 3:00pm" },
      { id: "s2", label: "wednesday july 22 at 10:00am" },
    ],
    ...overrides,
  };
}

describe("isBareAcceptance", () => {
  it("recognizes bare yeses", () => {
    for (const text of ["yes", "Sure!", "that works", "sounds good 👍", "ok", "Yep."]) {
      expect(isBareAcceptance(text)).toBe(true);
    }
  });

  it("does not flag slot-identifying acceptances", () => {
    for (const text of ["tuesday works", "yes, 3pm please", "the first one works"]) {
      expect(isBareAcceptance(text)).toBe(false);
    }
  });
});

describe("ambiguous yes guard", () => {
  it("downgrades a bare yes when more than one slot was proposed", () => {
    const result = applyReplyGuards(acceptParse(), input({ replyText: "sounds good" }));
    expect(result.intent).toBe("ambiguous");
    expect(result.requiresUserJudgment).toBe(true);
    expect(result.acceptedSlotId).toBeUndefined();
  });

  it("keeps a bare yes when exactly one slot was proposed", () => {
    const single = input({
      replyText: "sounds good",
      proposedSlots: [{ id: "s1", label: "tuesday july 21 at 3:00pm" }],
    });
    const result = applyReplyGuards(acceptParse(), single);
    expect(result.intent).toBe("accept_slot");
    expect(result.acceptedSlotId).toBe("s1");
    expect(result.requiresUserJudgment).toBe(false);
  });

  it("keeps a specific acceptance even with multiple slots proposed", () => {
    const result = applyReplyGuards(acceptParse(), input({ replyText: "tuesday works" }));
    expect(result.intent).toBe("accept_slot");
    expect(result.acceptedSlotId).toBe("s1");
  });
});

describe("slot id guard", () => {
  it("downgrades an accepted slot id that was never proposed", () => {
    const result = applyReplyGuards(acceptParse({ acceptedSlotId: "ghost" }), input());
    expect(result.intent).toBe("ambiguous");
    expect(result.requiresUserJudgment).toBe(true);
    expect(result.acceptedSlotId).toBeUndefined();
  });

  it("downgrades an acceptance with no slot id at all", () => {
    const parse = acceptParse();
    delete parse.acceptedSlotId;
    const result = applyReplyGuards(parse, input());
    expect(result.intent).toBe("ambiguous");
  });
});

describe("email guard", () => {
  it("normalizeEmail strips trailing punctuation", () => {
    expect(normalizeEmail("foo@bar.com.")).toBe("foo@bar.com");
    expect(normalizeEmail("foo@bar.com!")).toBe("foo@bar.com");
    expect(normalizeEmail("(foo@bar.co.uk)")).toBe("foo@bar.co.uk");
    expect(normalizeEmail("foo@bar.co.uk).")).toBe("foo@bar.co.uk");
  });

  it("normalizeEmail rejects invalid emails", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("foo@bar")).toBeNull();
    expect(normalizeEmail("foo bar@baz.com")).toBeNull();
  });

  it("cleans the email on provide_email", () => {
    const parsed: ParsedSchedulingMessage = {
      intent: "provide_email",
      email: "foo@bar.com.",
      confidence: 0.9,
      requiresUserJudgment: false,
    };
    const result = applyReplyGuards(parsed, input({ replyText: "it's foo@bar.com." }));
    expect(result.intent).toBe("provide_email");
    expect(result.email).toBe("foo@bar.com");
  });

  it("downgrades provide_email without a valid email", () => {
    const parsed: ParsedSchedulingMessage = {
      intent: "provide_email",
      email: "just ask my assistant",
      confidence: 0.9,
      requiresUserJudgment: false,
    };
    const result = applyReplyGuards(parsed, input());
    expect(result.intent).toBe("ambiguous");
    expect(result.requiresUserJudgment).toBe(true);
  });
});

describe("confidence guard", () => {
  it("forces user judgment below the review threshold", () => {
    const parsed = acceptParse({
      confidence: CONFIDENCE_REVIEW_THRESHOLD - 0.01,
      requiresUserJudgment: false,
    });
    const result = applyReplyGuards(parsed, input({ replyText: "tuesday works" }));
    expect(result.requiresUserJudgment).toBe(true);
    // intent itself is untouched by the confidence guard
    expect(result.intent).toBe("accept_slot");
  });

  it("leaves judgment alone at or above the threshold", () => {
    const parsed = acceptParse({ confidence: CONFIDENCE_REVIEW_THRESHOLD });
    const result = applyReplyGuards(parsed, input({ replyText: "tuesday works" }));
    expect(result.requiresUserJudgment).toBe(false);
  });
});
