import emojiRegex from "emoji-regex";
import { splitGraphemes } from "./graphemes.js";

export type TriggerValidationFailureReason =
  | "empty"
  | "multiple_graphemes"
  | "not_emoji";

export type TriggerValidationResult =
  | { valid: true; trigger: string }
  | { valid: false; reason: TriggerValidationFailureReason };

const VARIATION_SELECTOR_16 = "\u{FE0F}";

/** true when the whole string is exactly one emoji match (compound sequences included) */
function isEmoji(grapheme: string): boolean {
  if (grapheme === VARIATION_SELECTOR_16) return false;
  const matches = grapheme.match(emojiRegex());
  return matches !== null && matches.length === 1 && matches[0] === grapheme;
}

/**
 * validate a user-chosen trigger: exactly one visible grapheme cluster,
 * and that cluster must be an emoji (skin tones, zwj sequences, flags ok).
 */
export function validateTriggerEmoji(input: string): TriggerValidationResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: "empty" };
  }
  const graphemes = splitGraphemes(trimmed);
  if (graphemes.length !== 1) {
    return { valid: false, reason: "multiple_graphemes" };
  }
  const cluster = graphemes[0];
  if (cluster === undefined || !isEmoji(cluster)) {
    return { valid: false, reason: "not_emoji" };
  }
  return { valid: true, trigger: cluster };
}

/**
 * the trigger must be the first grapheme of the trimmed message, followed by
 * nothing (standalone) or whitespace (prefix). returns the remainder, or null
 * when the message is not trigger-led (e.g. the emoji sits inside a sentence).
 */
function matchTriggerPrefix(messageText: string, trigger: string): string | null {
  const trimmed = messageText.trim();
  if (!trimmed.startsWith(trigger)) return null;
  const rest = trimmed.slice(trigger.length);
  if (rest.length === 0) return "";
  // "📅x" is not a trigger; the trigger must stand alone or be whitespace-separated
  if (!/^\s/.test(rest)) return null;
  return rest.trim();
}

/** the message is the trigger alone (ignoring surrounding whitespace) */
export function isStandaloneTrigger(messageText: string, trigger: string): boolean {
  return matchTriggerPrefix(messageText, trigger) === "";
}

/**
 * modifier text after a leading trigger, e.g. "📅 30m" → "30m".
 * null for standalone triggers and for messages where the trigger
 * appears inside an unrelated sentence (or not at all).
 */
export function extractTriggerModifiers(messageText: string, trigger: string): string | null {
  const rest = matchTriggerPrefix(messageText, trigger);
  if (rest === null || rest === "") return null;
  return rest;
}

export { matchTriggerPrefix };
