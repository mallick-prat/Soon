import type { StyleFeatures } from "./features.js";

export interface ValidateDraftOptions {
  /** permit bullet lists (e.g. explicit multi-option layouts the caller wants) */
  allowLists?: boolean;
  /** the user's first name, to catch third-person references ("prat is available") */
  userFirstName?: string;
}

export type DraftValidationResult = { ok: true } | { ok: false; violations: string[] };

/** phrases a ghostwritten text must never contain (case-insensitive) */
const FORBIDDEN_ASSISTANT_PHRASES = [
  "scheduling assistant",
  "on behalf of",
  "as an ai",
  "i am an ai",
  "i'm an ai",
  "artificial intelligence",
  "calendar link",
  "let me check my calendar and get back",
] as const;

const CORPORATE_PHRASES = ["per my last", "circling back", "touch base"] as const;

const THIRD_PERSON_TEMPLATES = [
  "{name} is available",
  "{name} is free",
  "{name} has availability",
  "{name} can do",
  "{name} would like to",
  "{name}'s calendar",
] as const;

const BULLET_LINE = /^\s*(?:[-*•]|\d+[.)])\s+/m;

/**
 * count sentences: terminal punctuation followed by space/end, or line breaks.
 * a question + short sentence counts as 2 and passes.
 */
export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length;
}

/**
 * hard style constraints for any outbound draft. features are optional —
 * feature-dependent rules (exclamations, casing) only apply when provided.
 */
export function validateDraftText(
  text: string,
  features?: StyleFeatures,
  options: ValidateDraftOptions = {},
): DraftValidationResult {
  const violations: string[] = [];
  const lower = text.toLowerCase();

  if (text.trim().length === 0) {
    violations.push("empty draft");
    return { ok: false, violations };
  }

  if (countSentences(text) > 2) {
    violations.push("more than 2 sentences");
  }

  if (text.includes("—")) {
    violations.push("contains an em dash");
  }

  if (options.allowLists !== true && BULLET_LINE.test(text)) {
    violations.push("contains a bullet list");
  }

  for (const phrase of FORBIDDEN_ASSISTANT_PHRASES) {
    if (lower.includes(phrase)) {
      violations.push(`forbidden assistant language: "${phrase}"`);
    }
  }

  if (options.userFirstName !== undefined && options.userFirstName.length > 0) {
    const name = options.userFirstName.toLowerCase();
    for (const template of THIRD_PERSON_TEMPLATES) {
      const phrase = template.replace("{name}", name);
      if (lower.includes(phrase)) {
        violations.push(`third-person self reference: "${phrase}"`);
      }
    }
  }

  for (const phrase of CORPORATE_PHRASES) {
    if (lower.includes(phrase)) {
      violations.push(`corporate phrase: "${phrase}"`);
    }
  }

  if (features !== undefined) {
    if (!features.usesExclamations && text.includes("!")) {
      violations.push("exclamation mark, but the user never uses them");
    }

    if (features.lowercaseStyle) {
      const firstLetter = /\p{L}/u.exec(text)?.[0];
      if (
        firstLetter !== undefined &&
        firstLetter !== firstLetter.toLowerCase() &&
        firstLetter === firstLetter.toUpperCase()
      ) {
        violations.push("starts uppercase, but the user texts in lowercase");
      }
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
