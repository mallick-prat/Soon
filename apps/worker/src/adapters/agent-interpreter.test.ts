import { describe, expect, it, vi } from "vitest";
import type { CandidateSlot, InterpretedContext, ParsedSchedulingMessage } from "@soon/shared-types";
import { NoValidDraftError } from "@soon/agent";

import { createAgentInterpreter, llmFromEnv } from "./agent-interpreter.js";

const llm = {} as ReturnType<typeof llmFromEnv>;

const slot = (id: string): CandidateSlot => ({
  id,
  sessionId: "s1",
  startsAt: "2026-07-21T19:00:00.000Z",
  endsAt: "2026-07-21T19:30:00.000Z",
  timezone: "America/New_York",
  status: "candidate",
  score: 1,
  proposalRound: 1,
});

describe("createAgentInterpreter", () => {
  it("maps a draft result to { text, alternatives, confidence } and projects slots", async () => {
    const draftFn = vi.fn(async () => ({ drafts: ["how's tues at 3?", "tues 3 or thurs am?"], rejected: [] }));
    const interpreter = createAgentInterpreter({ llm, draftFn: draftFn as never });

    const result = await interpreter.draft({
      sessionId: "s1",
      objective: "propose_slots",
      slots: [slot("a"), slot("b")],
      styleExamples: ["yeah works"],
    });

    expect(result).toEqual({
      text: "how's tues at 3?",
      alternatives: ["tues 3 or thurs am?"],
      confidence: 0.9,
    });
    const req = draftFn.mock.calls[0]![1] as Record<string, unknown>;
    expect(req.relationship).toBe("unknown");
    expect(req.userTimezone).toBe("America/New_York");
    expect(req.slots).toEqual([
      { id: "a", startsAt: "2026-07-21T19:00:00.000Z", endsAt: "2026-07-21T19:30:00.000Z", timezone: "America/New_York" },
      { id: "b", startsAt: "2026-07-21T19:00:00.000Z", endsAt: "2026-07-21T19:30:00.000Z", timezone: "America/New_York" },
    ]);
  });

  it("throws NoValidDraftError when no candidate survives", async () => {
    const draftFn = vi.fn(async () => ({ drafts: [], rejected: [{ text: "bad", reason: "invented time" }] }));
    const interpreter = createAgentInterpreter({ llm, draftFn: draftFn as never });
    await expect(
      interpreter.draft({ sessionId: "s1", objective: "follow_up", slots: [], styleExamples: [] }),
    ).rejects.toBeInstanceOf(NoValidDraftError);
  });

  it("retakes once via regenerateAlternative when the first batch fails validation", async () => {
    const rejected = [{ text: "how about next week?", reason: "references a day outside the proposed slots" }];
    const draftFn = vi.fn(async () => {
      throw new NoValidDraftError(rejected);
    });
    const regenerateFn = vi.fn(async () => ({ drafts: ["tues at 3?"], rejected: [] }));
    const interpreter = createAgentInterpreter({
      llm,
      draftFn: draftFn as never,
      regenerateFn: regenerateFn as never,
    });

    const result = await interpreter.draft({
      sessionId: "s1",
      objective: "propose_slots",
      slots: [slot("a")],
      styleExamples: [],
    });

    expect(result.text).toBe("tues at 3?");
    // the retake sees the failed texts so it produces something different
    expect(regenerateFn.mock.calls[0]![2]).toEqual(["how about next week?"]);
  });

  it("propagates the failure when the retake also produces nothing valid", async () => {
    const draftFn = vi.fn(async () => {
      throw new NoValidDraftError([{ text: "bad", reason: "invented time" }]);
    });
    const regenerateFn = vi.fn(async () => {
      throw new NoValidDraftError([{ text: "worse", reason: "invented time again" }]);
    });
    const interpreter = createAgentInterpreter({
      llm,
      draftFn: draftFn as never,
      regenerateFn: regenerateFn as never,
    });
    await expect(
      interpreter.draft({ sessionId: "s1", objective: "propose_slots", slots: [slot("a")], styleExamples: [] }),
    ).rejects.toBeInstanceOf(NoValidDraftError);
  });

  it("converts proposed slots to id+label refs for reply interpretation", async () => {
    const parsed: ParsedSchedulingMessage = { intent: "accept_slot", acceptedSlotId: "a", confidence: 0.9, requiresUserJudgment: false };
    const interpretReplyFn = vi.fn(async () => parsed);
    const interpreter = createAgentInterpreter({ llm, interpretReplyFn: interpretReplyFn as never });

    const result = await interpreter.interpretReply({
      sessionId: "s1",
      replyText: "tuesday works",
      proposedSlots: [slot("a")],
      lastOutboundText: "how's tues at 3?",
    });

    expect(result).toBe(parsed);
    const input = interpretReplyFn.mock.calls[0]![1] as { proposedSlots: Array<{ id: string; label: string }>; recentMessages: unknown[] };
    expect(input.proposedSlots[0]!.id).toBe("a");
    expect(typeof input.proposedSlots[0]!.label).toBe("string");
    expect(input.proposedSlots[0]!.label.length).toBeGreaterThan(0);
    expect(input.recentMessages).toEqual([]);
  });

  it("passes context through to interpretContext", async () => {
    const interpreted = { bothPartiesAgreedToMeet: true } as InterpretedContext;
    const interpretContextFn = vi.fn(async () => interpreted);
    const interpreter = createAgentInterpreter({ llm, interpretContextFn: interpretContextFn as never });
    const ctx = { conversationReference: "c1" } as never;
    expect(await interpreter.interpretContext(ctx)).toBe(interpreted);
    expect(interpretContextFn).toHaveBeenCalledWith(llm, ctx);
  });
});

describe("llmFromEnv", () => {
  it("builds a model from valid env", () => {
    const model = llmFromEnv({ LLM_PROVIDER: "openai", LLM_MODEL: "gpt-4o-mini", LLM_API_KEY: "test" } as NodeJS.ProcessEnv);
    expect(model).toBeDefined();
  });

  it("rejects an unknown provider", () => {
    expect(() => llmFromEnv({ LLM_PROVIDER: "cohere", LLM_MODEL: "x", LLM_API_KEY: "k" } as NodeJS.ProcessEnv)).toThrow(/LLM_PROVIDER/);
  });

  it("requires model and key", () => {
    expect(() => llmFromEnv({ LLM_PROVIDER: "anthropic" } as NodeJS.ProcessEnv)).toThrow(/LLM_MODEL/);
    expect(() => llmFromEnv({ LLM_PROVIDER: "anthropic", LLM_MODEL: "claude" } as NodeJS.ProcessEnv)).toThrow(/LLM_API_KEY/);
  });
});
