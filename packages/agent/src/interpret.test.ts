import type { ActivationContext, InterpretedContext } from "@soon/shared-types";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { interpretActivationContext } from "./interpret-context.js";
import { interpretReply, type InterpretReplyInput } from "./interpret-reply.js";

function objectResult(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj) }],
    finishReason: { unified: "stop" as const },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  };
}

function mockModel(...objects: unknown[]): MockLanguageModelV3 {
  return new MockLanguageModelV3({ doGenerate: objects.map(objectResult) });
}

const activationContext: ActivationContext = {
  conversationReference: "conv-1",
  triggerMessageReference: "msg-9",
  triggerText: "📅",
  isGroup: false,
  participants: [
    { handle: "+15551234567", displayName: "sarah", isUser: false },
    { handle: "me", isUser: true },
  ],
  messages: [
    {
      localMessageReference: "msg-7",
      senderType: "attendee",
      text: "we should grab coffee next week!",
      sentAt: "2026-07-13T18:02:00.000Z",
    },
    {
      localMessageReference: "msg-8",
      senderType: "user",
      text: "yes lets do it",
      sentAt: "2026-07-13T18:05:00.000Z",
    },
  ],
};

const interpretedContext: InterpretedContext = {
  bothPartiesAgreedToMeet: true,
  meetingType: "coffee",
  format: "in_person",
  dateHints: ["next week"],
  hardConstraints: [],
  isProfessional: false,
  relationshipGuess: "close_friend",
  multipleInvitees: false,
  sensitive: false,
  confidence: 0.85,
};

describe("interpretActivationContext", () => {
  it("returns the schema-validated interpretation", async () => {
    const model = mockModel(interpretedContext);
    const result = await interpretActivationContext(model, activationContext);
    expect(result).toEqual(interpretedContext);
    expect(model.doGenerateCalls.length).toBe(1);
  });

  it("sends the conversation transcript to the model", async () => {
    const model = mockModel(interpretedContext);
    await interpretActivationContext(model, activationContext);
    const call = model.doGenerateCalls[0];
    expect(JSON.stringify(call?.prompt)).toContain("we should grab coffee next week!");
  });

  it("retries once when the first output fails schema validation", async () => {
    const invalid = { bothPartiesAgreedToMeet: "definitely" };
    const model = mockModel(invalid, interpretedContext);
    const result = await interpretActivationContext(model, activationContext);
    expect(result).toEqual(interpretedContext);
    expect(model.doGenerateCalls.length).toBe(2);
  });

  it("throws after a second schema failure", async () => {
    const invalid = { nonsense: true };
    const model = mockModel(invalid, invalid);
    await expect(interpretActivationContext(model, activationContext)).rejects.toThrow();
    expect(model.doGenerateCalls.length).toBe(2);
  });
});

const replyInput: InterpretReplyInput = {
  replyText: "sounds good",
  recentMessages: [
    { senderType: "user", text: "tuesday july 21 at 3pm or wednesday july 22 at 10am?" },
    { senderType: "attendee", text: "sounds good" },
  ],
  lastOutboundText: "tuesday july 21 at 3pm or wednesday july 22 at 10am?",
  proposedSlots: [
    { id: "s1", label: "tuesday july 21 at 3:00pm" },
    { id: "s2", label: "wednesday july 22 at 10:00am" },
  ],
};

describe("interpretReply", () => {
  it("applies the ambiguous-yes guard on top of the llm parse", async () => {
    const model = mockModel({
      intent: "accept_slot",
      acceptedSlotId: "s1",
      confidence: 0.92,
      requiresUserJudgment: false,
    });
    const result = await interpretReply(model, replyInput);
    expect(result.intent).toBe("ambiguous");
    expect(result.requiresUserJudgment).toBe(true);
  });

  it("passes through a specific acceptance untouched", async () => {
    const model = mockModel({
      intent: "accept_slot",
      acceptedSlotId: "s2",
      confidence: 0.92,
      requiresUserJudgment: false,
    });
    const result = await interpretReply(model, { ...replyInput, replyText: "wednesday works" });
    expect(result.intent).toBe("accept_slot");
    expect(result.acceptedSlotId).toBe("s2");
    expect(result.requiresUserJudgment).toBe(false);
  });

  it("forces review for low-confidence parses", async () => {
    const model = mockModel({
      intent: "provide_constraint",
      availabilityConstraints: { allowedWeekdays: [2, 3] },
      confidence: 0.4,
      requiresUserJudgment: false,
    });
    const result = await interpretReply(model, {
      ...replyInput,
      replyText: "early in the week is better",
    });
    expect(result.intent).toBe("provide_constraint");
    expect(result.requiresUserJudgment).toBe(true);
  });

  it("strips punctuation from a provided email", async () => {
    const model = mockModel({
      intent: "provide_email",
      email: "sarah@example.com.",
      confidence: 0.95,
      requiresUserJudgment: false,
    });
    const result = await interpretReply(model, {
      ...replyInput,
      replyText: "sarah@example.com.",
    });
    expect(result.email).toBe("sarah@example.com");
  });
});
