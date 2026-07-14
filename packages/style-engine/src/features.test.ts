import { describe, expect, it } from "vitest";
import { extractStyleFeatures } from "./features.js";

describe("extractStyleFeatures", () => {
  it("detects lowercase style", () => {
    const features = extractStyleFeatures([
      "hey whats up",
      "sounds good see you thurs",
      "im down for coffee",
    ]);
    expect(features.lowercaseStyle).toBe(true);
    expect(features.startsLowercaseRatio).toBe(1);
  });

  it("detects sentence-case style", () => {
    const features = extractStyleFeatures([
      "Hey, how are you?",
      "That works for me.",
      "See you Thursday.",
    ]);
    expect(features.lowercaseStyle).toBe(false);
    expect(features.usesTerminalPeriod).toBe(true);
  });

  it("measures average message length", () => {
    const features = extractStyleFeatures(["12345", "1234567"]);
    expect(features.avgMessageLength).toBe(6);
    expect(features.messageCount).toBe(2);
  });

  it("detects exclamation habits", () => {
    expect(extractStyleFeatures(["so excited!!", "great!"]).usesExclamations).toBe(true);
    expect(extractStyleFeatures(["ok", "cool"]).usesExclamations).toBe(false);
  });

  it("detects emoji usage rate", () => {
    const features = extractStyleFeatures(["see you there 🎉", "ok", "nice 👍", "yep"]);
    expect(features.usesEmoji).toBe(true);
    expect(features.emojiRate).toBeCloseTo(0.5);
    expect(extractStyleFeatures(["ok", "sure"]).usesEmoji).toBe(false);
  });

  it("finds acknowledgment phrases from the candidate list", () => {
    const features = extractStyleFeatures([
      "sounds good",
      "sounds good, see you then",
      "perfect",
    ]);
    expect(features.acknowledgments[0]).toBe("sounds good");
    expect(features.acknowledgments).toContain("perfect");
    expect(features.acknowledgments).toContain("see you then");
  });

  it("does not match acknowledgment substrings inside words", () => {
    const features = extractStyleFeatures(["the network is great at coworking"]);
    expect(features.acknowledgments).toContain("great");
    expect(features.acknowledgments).not.toContain("ok"); // not from "coworking"
  });

  it("detects day abbreviations", () => {
    const features = extractStyleFeatures(["can do thurs or fri", "tues works too"]);
    expect(features.usesAbbreviations).toBe(true);
    expect(features.abbreviations).toEqual(expect.arrayContaining(["thurs", "fri", "tues"]));
  });

  it("detects compact time format (3pm)", () => {
    expect(extractStyleFeatures(["3pm works", "or 5 pm"]).timeFormatHint).toBe("compact");
  });

  it("detects padded time format (3:00 pm)", () => {
    expect(extractStyleFeatures(["3:00 pm works", "how about 4:30"]).timeFormatHint).toBe("padded");
  });

  it("handles empty input", () => {
    const features = extractStyleFeatures([]);
    expect(features.messageCount).toBe(0);
    expect(features.lowercaseStyle).toBe(false);
    expect(features.timeFormatHint).toBe("unknown");
    expect(features.avgMessageLength).toBe(0);
  });

  it("is deterministic", () => {
    const messages = ["sounds good, 3pm thurs!", "see you then 🎉"];
    expect(extractStyleFeatures(messages)).toEqual(extractStyleFeatures(messages));
  });
});
