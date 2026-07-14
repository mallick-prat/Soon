/**
 * trigger detection — a message activates soon when it is the configured
 * emoji standing alone at the start of a user-authored message, sent after
 * install, newer than the persisted cursor, in an eligible conversation.
 *
 * also parses user commands ("📅 stop", "📅 approve 2", ...) generic over
 * the configured trigger emoji.
 */
import emojiRegexFactory from "emoji-regex";
import GraphemeSplitter from "grapheme-splitter";

import type { LocalMessage } from "./types.js";

const splitter = new GraphemeSplitter();

/** split a string into grapheme clusters (Intl.Segmenter, splitter fallback). */
export const graphemes = (text: string): string[] => {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return splitter.splitGraphemes(text);
};

/** true when `text` is exactly one grapheme cluster and that cluster is an emoji. */
export const isSingleEmojiGrapheme = (text: string): boolean => {
  const clusters = graphemes(text);
  if (clusters.length !== 1) return false;
  const regex = emojiRegexFactory();
  const match = regex.exec(text);
  return match !== null && match[0] === text;
};

/** max group size (including the user) soon will activate in. */
export const MAX_GROUP_PARTICIPANTS = 10;

export type UserCommand =
  | { kind: "stop" }
  | { kind: "status" }
  | { kind: "take_over" }
  | { kind: "resume" }
  | { kind: "cancel" }
  | { kind: "undo" }
  | { kind: "approve"; index: number };

export type IgnoreReason =
  | "not_from_me"
  | "no_trigger"
  | "before_install"
  | "not_after_cursor"
  | "conversation_blocked"
  | "conversation_paused"
  | "active_session"
  | "group_too_large";

export type TriggerResult =
  | { type: "activation"; modifierText: string }
  | { type: "command"; command: UserCommand }
  | { type: "ignored"; reason: IgnoreReason };

export interface TriggerContext {
  /** configured trigger — must be a single emoji grapheme (may be compound). */
  triggerEmoji: string;
  /** epoch millis the app was installed; only newer messages can trigger. */
  installedAtMs: number;
  /** last processed message timestamp for this conversation (0 when none). */
  cursorMs: number;
  conversationBlocked: boolean;
  conversationPaused: boolean;
  hasActiveSession: boolean;
  /** total participants including the user (relevant for groups). */
  participantCount: number;
}

/**
 * the text starts with the trigger emoji as a standalone token — returns
 * the remainder after the trigger, or undefined when the trigger is absent
 * or inline (not at the start / glued to non-space text).
 */
const splitAtTrigger = (rawText: string, triggerEmoji: string): string | undefined => {
  const text = rawText.trim();
  if (!text.startsWith(triggerEmoji)) return undefined;
  const rest = text.slice(triggerEmoji.length);
  if (rest === "") return "";
  // the trigger must stand alone: "📅tomorrow" is not a trigger, "📅 tomorrow" is.
  if (!/^\s/.test(rest)) return undefined;
  return rest.trim();
};

/** parse a user command written after the trigger. undefined = not a command. */
export const parseUserCommand = (rawText: string, triggerEmoji: string): UserCommand | undefined => {
  const rest = splitAtTrigger(rawText, triggerEmoji);
  if (rest === undefined || rest === "") return undefined;
  const normalized = rest.toLowerCase().replace(/\s+/g, " ").trim();
  switch (normalized) {
    case "stop":
      return { kind: "stop" };
    case "status":
      return { kind: "status" };
    case "take over":
    case "takeover":
      return { kind: "take_over" };
    case "resume":
      return { kind: "resume" };
    case "cancel":
      return { kind: "cancel" };
    case "undo":
      return { kind: "undo" };
    default: {
      const approve = /^approve (\d{1,2})$/.exec(normalized);
      if (approve?.[1] !== undefined) {
        const index = Number.parseInt(approve[1], 10);
        if (index >= 1) return { kind: "approve", index };
      }
      return undefined;
    }
  }
};

/** commands that must work even while the conversation is paused/blocked. */
const ALWAYS_ALLOWED_COMMANDS: ReadonlySet<UserCommand["kind"]> = new Set(["resume", "status", "stop"]);

/**
 * classify one user-authored message. commands take precedence over
 * activation; any other text after the trigger passes through as modifier.
 */
export const detectTrigger = (msg: LocalMessage, ctx: TriggerContext): TriggerResult => {
  if (!msg.isFromMe) return { type: "ignored", reason: "not_from_me" };

  const rest = splitAtTrigger(msg.text, ctx.triggerEmoji);
  if (rest === undefined) return { type: "ignored", reason: "no_trigger" };

  if (msg.sentAtMs <= ctx.installedAtMs) return { type: "ignored", reason: "before_install" };
  if (msg.sentAtMs <= ctx.cursorMs) return { type: "ignored", reason: "not_after_cursor" };

  const command = parseUserCommand(msg.text, ctx.triggerEmoji);
  if (command !== undefined) {
    if (
      !ALWAYS_ALLOWED_COMMANDS.has(command.kind) &&
      (ctx.conversationBlocked || ctx.conversationPaused)
    ) {
      return {
        type: "ignored",
        reason: ctx.conversationBlocked ? "conversation_blocked" : "conversation_paused",
      };
    }
    return { type: "command", command };
  }

  // activation path
  if (ctx.conversationBlocked) return { type: "ignored", reason: "conversation_blocked" };
  if (ctx.conversationPaused) return { type: "ignored", reason: "conversation_paused" };
  if (ctx.hasActiveSession) return { type: "ignored", reason: "active_session" };
  if (msg.isGroup && ctx.participantCount > MAX_GROUP_PARTICIPANTS) {
    return { type: "ignored", reason: "group_too_large" };
  }

  return { type: "activation", modifierText: rest };
};

/** validate a configured trigger emoji (settings ui / defaults). */
export const isValidTriggerEmoji = (candidate: string): boolean => isSingleEmojiGrapheme(candidate.trim());

export const DEFAULT_TRIGGER_EMOJI = "📅";
