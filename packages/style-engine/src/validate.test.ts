import { describe, expect, it } from "vitest";
import { extractStyleFeatures } from "./features.js";
import { countSentences, validateDraftText } from "./validate.js";

const lowercaseNoBang = extractStyleFeatures([
  "hey whats up",
  "sounds good",
  "see you thurs",
]);

function violationsOf(result: ReturnType<typeof validateDraftText>): string[] {
  return result.ok ? [] : result.violations;
}

describe("countSentences", () => {
  it("counts question + short sentence as 2", () => {
    expect(countSentences("does tuesday at 3pm work? wednesday is open too")).toBe(2);
  });

  it("counts terminal punctuation and line breaks", () => {
    expect(countSentences("one. two. three.")).toBe(3);
    expect(countSentences("one\ntwo\nthree")).toBe(3);
  });
});

describe("validateDraftText hard rules", () => {
  it("accepts a good short draft", () => {
    expect(validateDraftText("does tuesday at 3pm work? wednesday morning is open too")).toEqual({
      ok: true,
    });
  });

  it("rejects more than 2 sentences", () => {
    const result = validateDraftText("hey. i checked. tuesday works. see you then.");
    expect(violationsOf(result)).toContain("more than 2 sentences");
  });

  it("rejects em dashes", () => {
    expect(violationsOf(validateDraftText("tuesday works — or wednesday"))).toContain(
      "contains an em dash",
    );
  });

  it("rejects bullet lists unless allowed", () => {
    const list = "here are options\n- tuesday 3pm\n- wednesday 10am";
    expect(validateDraftText(list).ok).toBe(false);
    const allowed = validateDraftText("- tuesday 3pm\n- wednesday 10am", undefined, {
      allowLists: true,
    });
    expect(violationsOf(allowed)).not.toContain("contains a bullet list");
  });

  it("rejects forbidden assistant language, case-insensitive", () => {
    for (const bad of [
      "I'm his Scheduling Assistant",
      "sending this on behalf of prat",
      "as an AI i cannot",
      "here's a calendar link",
      "let me check my calendar and get back to you",
    ]) {
      expect(validateDraftText(bad).ok).toBe(false);
    }
  });

  it("rejects third-person self references given userFirstName", () => {
    const result = validateDraftText("Prat is available tuesday at 3pm", undefined, {
      userFirstName: "Prat",
    });
    expect(result.ok).toBe(false);
    // without the name it cannot know
    expect(validateDraftText("prat is available tuesday at 3pm").ok).toBe(true);
  });

  it("rejects corporate phrases", () => {
    expect(validateDraftText("circling back on this").ok).toBe(false);
    expect(validateDraftText("want to touch base tomorrow?").ok).toBe(false);
    expect(validateDraftText("per my last message").ok).toBe(false);
  });

  it("rejects exclamation marks when the user never uses them", () => {
    expect(validateDraftText("tuesday works!", lowercaseNoBang).ok).toBe(false);
    // fine without features
    expect(validateDraftText("tuesday works!").ok).toBe(true);
    // fine when the user does use them
    const excitable = extractStyleFeatures(["so fun!", "yes!"]);
    expect(validateDraftText("tuesday works!", excitable).ok).toBe(true);
  });

  it("rejects uppercase start for lowercase-style users", () => {
    expect(validateDraftText("Does tuesday work", lowercaseNoBang).ok).toBe(false);
    expect(validateDraftText("does tuesday work", lowercaseNoBang).ok).toBe(true);
  });

  it("collects multiple violations", () => {
    const result = validateDraftText(
      "Circling back — Prat is available. Let me know. Thanks!",
      lowercaseNoBang,
      { userFirstName: "prat" },
    );
    expect(result.ok).toBe(false);
    expect(violationsOf(result).length).toBeGreaterThanOrEqual(4);
  });

  it("rejects empty drafts", () => {
    expect(validateDraftText("  ").ok).toBe(false);
  });
});
