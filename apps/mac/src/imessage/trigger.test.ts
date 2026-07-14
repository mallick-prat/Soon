import { describe, expect, it } from "vitest";

import { makeMessage } from "../test-helpers.js";
import {
  DEFAULT_TRIGGER_EMOJI,
  detectTrigger,
  isSingleEmojiGrapheme,
  isValidTriggerEmoji,
  parseUserCommand,
  type TriggerContext,
} from "./trigger.js";

const baseCtx: TriggerContext = {
  triggerEmoji: DEFAULT_TRIGGER_EMOJI,
  installedAtMs: 1_700_000_000_000,
  cursorMs: 0,
  conversationBlocked: false,
  conversationPaused: false,
  hasActiveSession: false,
  participantCount: 2,
};

const AFTER_INSTALL = 1_700_000_100_000;

describe("trigger detection", () => {
  it("activates on the standalone trigger emoji", () => {
    const result = detectTrigger(makeMessage({ text: "📅", sentAtMs: AFTER_INSTALL }), baseCtx);
    expect(result).toEqual({ type: "activation", modifierText: "" });
  });

  it("passes modifier text after the trigger through", () => {
    const result = detectTrigger(
      makeMessage({ text: "📅 sometime next week, 30 min", sentAtMs: AFTER_INSTALL }),
      baseCtx,
    );
    expect(result).toEqual({ type: "activation", modifierText: "sometime next week, 30 min" });
  });

  it("ignores the emoji inline mid-message", () => {
    const result = detectTrigger(makeMessage({ text: "let's grab lunch 📅 soon", sentAtMs: AFTER_INSTALL }), baseCtx);
    expect(result).toEqual({ type: "ignored", reason: "no_trigger" });
  });

  it("ignores the emoji glued to following text", () => {
    const result = detectTrigger(makeMessage({ text: "📅tomorrow", sentAtMs: AFTER_INSTALL }), baseCtx);
    expect(result).toEqual({ type: "ignored", reason: "no_trigger" });
  });

  it("ignores messages not authored by the user", () => {
    const result = detectTrigger(makeMessage({ text: "📅", sentAtMs: AFTER_INSTALL, isFromMe: false }), baseCtx);
    expect(result).toEqual({ type: "ignored", reason: "not_from_me" });
  });

  it("ignores historical messages sent before install", () => {
    const result = detectTrigger(makeMessage({ text: "📅", sentAtMs: baseCtx.installedAtMs - 1 }), baseCtx);
    expect(result).toEqual({ type: "ignored", reason: "before_install" });
  });

  it("ignores messages at or before the persisted cursor", () => {
    const result = detectTrigger(makeMessage({ text: "📅", sentAtMs: AFTER_INSTALL }), {
      ...baseCtx,
      cursorMs: AFTER_INSTALL,
    });
    expect(result).toEqual({ type: "ignored", reason: "not_after_cursor" });
  });

  it("ignores blocked and paused conversations", () => {
    const msg = makeMessage({ text: "📅", sentAtMs: AFTER_INSTALL });
    expect(detectTrigger(msg, { ...baseCtx, conversationBlocked: true })).toEqual({
      type: "ignored",
      reason: "conversation_blocked",
    });
    expect(detectTrigger(msg, { ...baseCtx, conversationPaused: true })).toEqual({
      type: "ignored",
      reason: "conversation_paused",
    });
  });

  it("does not re-activate while a session is active", () => {
    const result = detectTrigger(makeMessage({ text: "📅", sentAtMs: AFTER_INSTALL }), {
      ...baseCtx,
      hasActiveSession: true,
    });
    expect(result).toEqual({ type: "ignored", reason: "active_session" });
  });

  it("ignores groups larger than 10 participants but allows 10 or fewer", () => {
    const msg = makeMessage({ text: "📅", sentAtMs: AFTER_INSTALL, isGroup: true });
    expect(detectTrigger(msg, { ...baseCtx, participantCount: 11 })).toEqual({
      type: "ignored",
      reason: "group_too_large",
    });
    expect(detectTrigger(msg, { ...baseCtx, participantCount: 10 })).toEqual({
      type: "activation",
      modifierText: "",
    });
  });

  it("supports a custom compound (zwj) emoji trigger", () => {
    const ctx: TriggerContext = { ...baseCtx, triggerEmoji: "👩‍💻" };
    expect(detectTrigger(makeMessage({ text: "👩‍💻", sentAtMs: AFTER_INSTALL }), ctx)).toEqual({
      type: "activation",
      modifierText: "",
    });
    expect(detectTrigger(makeMessage({ text: "👩‍💻 coffee thursday?", sentAtMs: AFTER_INSTALL }), ctx)).toEqual({
      type: "activation",
      modifierText: "coffee thursday?",
    });
    // the default emoji must not fire when a custom trigger is configured
    expect(detectTrigger(makeMessage({ text: "📅", sentAtMs: AFTER_INSTALL }), ctx)).toEqual({
      type: "ignored",
      reason: "no_trigger",
    });
  });

  it("treats plain text without the trigger as no trigger", () => {
    const result = detectTrigger(makeMessage({ text: "see you tomorrow", sentAtMs: AFTER_INSTALL }), baseCtx);
    expect(result).toEqual({ type: "ignored", reason: "no_trigger" });
  });
});

describe("user commands", () => {
  it("parses all fixed commands generically over the trigger", () => {
    expect(parseUserCommand("📅 stop", "📅")).toEqual({ kind: "stop" });
    expect(parseUserCommand("📅 status", "📅")).toEqual({ kind: "status" });
    expect(parseUserCommand("📅 take over", "📅")).toEqual({ kind: "take_over" });
    expect(parseUserCommand("📅 resume", "📅")).toEqual({ kind: "resume" });
    expect(parseUserCommand("📅 cancel", "📅")).toEqual({ kind: "cancel" });
    expect(parseUserCommand("📅 undo", "📅")).toEqual({ kind: "undo" });
    expect(parseUserCommand("👩‍💻 stop", "👩‍💻")).toEqual({ kind: "stop" });
  });

  it("parses approve N with its index", () => {
    expect(parseUserCommand("📅 approve 2", "📅")).toEqual({ kind: "approve", index: 2 });
    expect(parseUserCommand("📅 approve 0", "📅")).toBeUndefined();
    expect(parseUserCommand("📅 approve x", "📅")).toBeUndefined();
  });

  it("is case- and whitespace-insensitive", () => {
    expect(parseUserCommand("📅  Take   Over ", "📅")).toEqual({ kind: "take_over" });
  });

  it("classifies command messages as commands, taking precedence over activation", () => {
    const result = detectTrigger(makeMessage({ text: "📅 stop", sentAtMs: AFTER_INSTALL }), {
      ...baseCtx,
      hasActiveSession: true,
    });
    expect(result).toEqual({ type: "command", command: { kind: "stop" } });
  });

  it("allows resume in a blocked conversation but not new activations", () => {
    const ctx = { ...baseCtx, conversationBlocked: true };
    expect(detectTrigger(makeMessage({ text: "📅 resume", sentAtMs: AFTER_INSTALL }), ctx)).toEqual({
      type: "command",
      command: { kind: "resume" },
    });
    expect(detectTrigger(makeMessage({ text: "📅", sentAtMs: AFTER_INSTALL }), ctx)).toEqual({
      type: "ignored",
      reason: "conversation_blocked",
    });
  });

  it("treats non-command trailing text as modifier, not command", () => {
    const result = detectTrigger(
      makeMessage({ text: "📅 stop by whenever works", sentAtMs: AFTER_INSTALL }),
      baseCtx,
    );
    expect(result).toEqual({ type: "activation", modifierText: "stop by whenever works" });
  });
});

describe("emoji validation", () => {
  it("accepts single emoji graphemes including compound sequences", () => {
    expect(isSingleEmojiGrapheme("📅")).toBe(true);
    expect(isSingleEmojiGrapheme("👩‍💻")).toBe(true);
    expect(isSingleEmojiGrapheme("🏳️‍🌈")).toBe(true);
  });

  it("rejects multi-grapheme or non-emoji strings", () => {
    expect(isSingleEmojiGrapheme("📅📅")).toBe(false);
    expect(isSingleEmojiGrapheme("a")).toBe(false);
    expect(isSingleEmojiGrapheme("📅a")).toBe(false);
    expect(isValidTriggerEmoji("hello")).toBe(false);
    expect(isValidTriggerEmoji(" 📅 ")).toBe(true);
  });
});
