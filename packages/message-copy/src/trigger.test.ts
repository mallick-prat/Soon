import { describe, expect, it } from "vitest";
import {
  extractTriggerModifiers,
  isStandaloneTrigger,
  validateTriggerEmoji,
} from "./trigger.js";

describe("validateTriggerEmoji", () => {
  it("accepts a simple emoji", () => {
    expect(validateTriggerEmoji("📅")).toEqual({ valid: true, trigger: "📅" });
  });

  it("accepts skin-tone variants", () => {
    expect(validateTriggerEmoji("👍🏽")).toEqual({ valid: true, trigger: "👍🏽" });
  });

  it("accepts zwj sequences", () => {
    expect(validateTriggerEmoji("👩‍💻")).toEqual({ valid: true, trigger: "👩‍💻" });
    expect(validateTriggerEmoji("👨‍👩‍👧‍👦")).toEqual({ valid: true, trigger: "👨‍👩‍👧‍👦" });
  });

  it("accepts flag emoji including sequence flags", () => {
    expect(validateTriggerEmoji("🇺🇸")).toEqual({ valid: true, trigger: "🇺🇸" });
    expect(validateTriggerEmoji("🏳️‍🌈")).toEqual({ valid: true, trigger: "🏳️‍🌈" });
  });

  it("accepts variation-selector emoji like ☀️ and keycaps", () => {
    expect(validateTriggerEmoji("☀️")).toEqual({ valid: true, trigger: "☀️" });
    expect(validateTriggerEmoji("1️⃣")).toEqual({ valid: true, trigger: "1️⃣" });
  });

  it("trims surrounding whitespace", () => {
    expect(validateTriggerEmoji(" 📅 ")).toEqual({ valid: true, trigger: "📅" });
  });

  it("rejects empty and whitespace-only input", () => {
    expect(validateTriggerEmoji("")).toEqual({ valid: false, reason: "empty" });
    expect(validateTriggerEmoji("   ")).toEqual({ valid: false, reason: "empty" });
    expect(validateTriggerEmoji("\n\t")).toEqual({ valid: false, reason: "empty" });
  });

  it("rejects plain text", () => {
    expect(validateTriggerEmoji("x")).toEqual({ valid: false, reason: "not_emoji" });
    expect(validateTriggerEmoji("hi")).toEqual({ valid: false, reason: "multiple_graphemes" });
    expect(validateTriggerEmoji("3")).toEqual({ valid: false, reason: "not_emoji" });
  });

  it("rejects a bare variation selector", () => {
    expect(validateTriggerEmoji("\u{FE0F}")).toEqual({ valid: false, reason: "not_emoji" });
  });

  it("rejects multiple graphemes", () => {
    expect(validateTriggerEmoji("📅📅")).toEqual({ valid: false, reason: "multiple_graphemes" });
    expect(validateTriggerEmoji("👍🏽👍🏽")).toEqual({ valid: false, reason: "multiple_graphemes" });
  });

  it("rejects emoji followed by text", () => {
    expect(validateTriggerEmoji("📅x")).toEqual({ valid: false, reason: "multiple_graphemes" });
    expect(validateTriggerEmoji("📅 x")).toEqual({ valid: false, reason: "multiple_graphemes" });
  });
});

describe("isStandaloneTrigger", () => {
  it("matches the trigger alone", () => {
    expect(isStandaloneTrigger("📅", "📅")).toBe(true);
    expect(isStandaloneTrigger("  📅  ", "📅")).toBe(true);
  });

  it("matches compound-emoji triggers", () => {
    expect(isStandaloneTrigger("👩‍💻", "👩‍💻")).toBe(true);
  });

  it("does not match trigger with modifiers or inline usage", () => {
    expect(isStandaloneTrigger("📅 30m", "📅")).toBe(false);
    expect(isStandaloneTrigger("let's do 📅 tomorrow", "📅")).toBe(false);
    expect(isStandaloneTrigger("📅📅", "📅")).toBe(false);
    expect(isStandaloneTrigger("hello", "📅")).toBe(false);
  });

  it("does not match a different emoji", () => {
    expect(isStandaloneTrigger("🗓️", "📅")).toBe(false);
  });
});

describe("extractTriggerModifiers", () => {
  it("extracts modifier text after the trigger", () => {
    expect(extractTriggerModifiers("📅 30m", "📅")).toBe("30m");
    expect(extractTriggerModifiers("📅 follow up until scheduled", "📅")).toBe(
      "follow up until scheduled",
    );
    expect(extractTriggerModifiers("  📅   coffee next week  ", "📅")).toBe("coffee next week");
  });

  it("returns null for the standalone trigger", () => {
    expect(extractTriggerModifiers("📅", "📅")).toBeNull();
    expect(extractTriggerModifiers(" 📅 ", "📅")).toBeNull();
  });

  it("returns null when the trigger appears inside an unrelated sentence", () => {
    expect(extractTriggerModifiers("i put it on the 📅 already", "📅")).toBeNull();
    expect(extractTriggerModifiers("see you then 📅", "📅")).toBeNull();
  });

  it("returns null when the trigger is glued to text", () => {
    expect(extractTriggerModifiers("📅x", "📅")).toBeNull();
    expect(extractTriggerModifiers("📅30m", "📅")).toBeNull();
  });

  it("returns null when the trigger is absent", () => {
    expect(extractTriggerModifiers("30m", "📅")).toBeNull();
  });
});
