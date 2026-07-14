import { extractStyleFeatures, styleDirectives } from "@soon/style-engine";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import {
  draftMessage,
  formatSlotLabel,
  regenerateAlternative,
  verifyDraftTimes,
  type DraftMessageRequest,
  type SlotRef,
} from "./draft.js";
import { NoValidDraftError } from "./errors.js";

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

// thursday, so "tuesday"/"wednesday" forward-resolve to jul 21 / jul 22
const NOW = new Date("2026-07-16T12:00:00.000Z");

const slots: SlotRef[] = [
  {
    id: "s1",
    startsAt: "2026-07-21T19:00:00.000Z", // tue jul 21, 3:00pm ET
    endsAt: "2026-07-21T19:30:00.000Z",
    timezone: "America/New_York",
  },
  {
    id: "s2",
    startsAt: "2026-07-22T14:00:00.000Z", // wed jul 22, 10:00am ET
    endsAt: "2026-07-22T14:30:00.000Z",
    timezone: "America/New_York",
  },
];

const userStyle = extractStyleFeatures([
  "hey whats up",
  "sounds good",
  "see you thurs",
  "3pm works for me",
]);

function request(overrides: Partial<DraftMessageRequest> = {}): DraftMessageRequest {
  return {
    objective: "propose_slots",
    slots,
    relationship: "close_friend",
    styleDirectives: styleDirectives(userStyle, "close_friend"),
    styleFeatures: userStyle,
    userFirstName: "prat",
    userTimezone: "America/New_York",
    now: NOW,
    ...overrides,
  };
}

describe("formatSlotLabel", () => {
  it("formats a deterministic lowercase label in the slot timezone", () => {
    expect(formatSlotLabel(slots[0] as SlotRef)).toBe("tuesday july 21 at 3:00pm");
    expect(formatSlotLabel(slots[1] as SlotRef)).toBe("wednesday july 22 at 10:00am");
  });
});

describe("verifyDraftTimes", () => {
  it("accepts text with no time expressions", () => {
    expect(verifyDraftTimes("what day works best for you?", slots, NOW, "America/New_York")).toEqual(
      { ok: true },
    );
  });

  it("accepts exact slot references", () => {
    expect(
      verifyDraftTimes(
        "does tuesday july 21 at 3pm work? wednesday july 22 at 10am is open too",
        slots,
        NOW,
        "America/New_York",
      ),
    ).toEqual({ ok: true });
  });

  it("accepts within the ±30min tolerance", () => {
    expect(
      verifyDraftTimes("tuesday july 21 at 2:45pm?", slots, NOW, "America/New_York").ok,
    ).toBe(true);
  });

  it("rejects invented times", () => {
    const result = verifyDraftTimes("how about saturday at 9?", slots, NOW, "America/New_York");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("saturday at 9");
  });

  it("rejects a time far from any slot even on the right day", () => {
    expect(verifyDraftTimes("tuesday july 21 at 5pm?", slots, NOW, "America/New_York").ok).toBe(
      false,
    );
  });

  it("accepts a day-level reference to a proposed day, rejects other days", () => {
    expect(verifyDraftTimes("would tuesday work?", slots, NOW, "America/New_York").ok).toBe(true);
    expect(verifyDraftTimes("would friday work?", slots, NOW, "America/New_York").ok).toBe(false);
  });

  it("handles uncertain meridiem by considering both readings", () => {
    const eveningSlot: SlotRef[] = [
      {
        id: "s9",
        startsAt: "2026-07-19T01:00:00.000Z", // sat jul 18, 9:00pm ET
        endsAt: "2026-07-19T02:00:00.000Z",
        timezone: "America/New_York",
      },
    ];
    expect(
      verifyDraftTimes("how about saturday at 9?", eveningSlot, NOW, "America/New_York").ok,
    ).toBe(true);
  });

  it("rejects any time reference when no slots are provided", () => {
    expect(verifyDraftTimes("free tuesday at 3pm?", [], NOW, "America/New_York").ok).toBe(false);
    expect(verifyDraftTimes("what works for you?", [], NOW, "America/New_York").ok).toBe(true);
  });
});

describe("draftMessage", () => {
  it("returns validated drafts (happy path)", async () => {
    const model = mockModel({
      candidates: [
        "does tuesday july 21 at 3pm work? wednesday july 22 at 10am is open too",
        "free tuesday july 21 at 3pm?",
      ],
    });
    const result = await draftMessage(model, request());
    expect(result.drafts.length).toBe(2);
    expect(result.rejected).toEqual([]);
  });

  it("rejects candidates that invent availability", async () => {
    const model = mockModel({
      candidates: ["how about saturday at 9?", "free tuesday july 21 at 3pm?"],
    });
    const result = await draftMessage(model, request());
    expect(result.drafts).toEqual(["free tuesday july 21 at 3pm?"]);
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0]?.reason).toContain("saturday at 9");
  });

  it("rejects style violations", async () => {
    const model = mockModel({
      candidates: [
        "Prat is available tuesday july 21 at 3pm!",
        "free tuesday july 21 at 3pm?",
      ],
    });
    const result = await draftMessage(model, request());
    expect(result.drafts).toEqual(["free tuesday july 21 at 3pm?"]);
    expect(result.rejected[0]?.reason).toContain("style:");
  });

  it("dedupes near-identical candidates", async () => {
    const model = mockModel({
      candidates: ["free tuesday july 21 at 3pm?", "free tuesday july 21 at 3pm"],
    });
    const result = await draftMessage(model, request());
    expect(result.drafts.length).toBe(1);
    expect(result.rejected[0]?.reason).toContain("duplicate");
  });

  it("throws NoValidDraftError when everything is rejected", async () => {
    const model = mockModel({
      candidates: ["how about saturday at 9?", "let me check my calendar and get back to you"],
    });
    const error = await draftMessage(model, request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NoValidDraftError);
    expect((error as NoValidDraftError).rejected.length).toBe(2);
  });
});

describe("regenerateAlternative", () => {
  it("rejects repeats of previous drafts and keeps new structures", async () => {
    const previous = ["does tuesday july 21 at 3pm work? wednesday july 22 at 10am is open too"];
    const model = mockModel({
      candidates: [
        "does tuesday july 21 at 3pm work? wednesday july 22 at 10am is open too",
        "would tuesday work for you?",
      ],
    });
    const result = await regenerateAlternative(model, request(), previous);
    expect(result.drafts).toEqual(["would tuesday work for you?"]);
    expect(result.rejected[0]?.reason).toContain("duplicate");
  });

  it("tells the model not to repeat previous drafts, with the same slots", async () => {
    const previous = ["does tuesday july 21 at 3pm work?"];
    const model = mockModel({ candidates: ["would tuesday work for you?"] });
    await regenerateAlternative(model, request(), previous);
    const promptText = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(promptText).toContain("do not repeat");
    expect(promptText).toContain("tuesday july 21 at 3:00pm");
  });

  it("never regenerates different availability", async () => {
    const model = mockModel({ candidates: ["could also do friday july 24 at 1pm"] });
    await expect(
      regenerateAlternative(model, request(), ["free tuesday july 21 at 3pm?"]),
    ).rejects.toBeInstanceOf(NoValidDraftError);
  });
});
