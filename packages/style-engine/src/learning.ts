/**
 * learn from the user's edits to drafts. edits generate weak signals;
 * a preference only becomes active after ≥3 consistent observations,
 * and an opposing observation resets the streak.
 */

export type StyleEditSignalKind =
  | "formality_removed"
  | "terminal_punctuation_stripped"
  | "shortened"
  | "lengthened"
  | "emoji_added"
  | "emoji_removed"
  | "exclamation_added"
  | "exclamation_removed"
  | "option_count_reduced"
  | "time_format_changed"
  | "lowercased"
  | "capitalized";

export interface StyleEditSignal {
  kind: StyleEditSignalKind;
  detail?: string;
}

export interface PreferenceState {
  observations: number;
  active: boolean;
}

export type StyleProfile = Partial<Record<StyleEditSignalKind, PreferenceState>>;

export const PREFERENCE_ACTIVATION_THRESHOLD = 3;

const OPPOSITES: Partial<Record<StyleEditSignalKind, StyleEditSignalKind>> = {
  shortened: "lengthened",
  lengthened: "shortened",
  emoji_added: "emoji_removed",
  emoji_removed: "emoji_added",
  exclamation_added: "exclamation_removed",
  exclamation_removed: "exclamation_added",
  lowercased: "capitalized",
  capitalized: "lowercased",
};

const FORMAL_MARKERS = [
  "unfortunately",
  "certainly",
  "i would like",
  "i wanted to",
  "please let me know",
  "looking forward to",
  "kind regards",
  "best regards",
  "at your earliest convenience",
] as const;

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const TIME_EXPRESSION = /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/gi;
const PADDED_TIME = /\b\d{1,2}:\d{2}\s?(am|pm)?\b/i;
const COMPACT_TIME = /\b\d{1,2}\s?(am|pm)\b/i;

function countTimeExpressions(text: string): number {
  return text.match(new RegExp(TIME_EXPRESSION.source, TIME_EXPRESSION.flags))?.length ?? 0;
}

function timeFormat(text: string): "compact" | "padded" | "none" {
  if (PADDED_TIME.test(text)) return "padded";
  if (COMPACT_TIME.test(text)) return "compact";
  return "none";
}

function firstLetter(text: string): string | undefined {
  return /\p{L}/u.exec(text)?.[0];
}

/** compare the draft soon produced with what the user actually sent */
export function captureEditDiff(originalDraft: string, finalText: string): StyleEditSignal[] {
  const signals: StyleEditSignal[] = [];
  const original = originalDraft.trim();
  const final = finalText.trim();
  if (original === final || final.length === 0) return signals;

  const originalLower = original.toLowerCase();
  const finalLower = final.toLowerCase();

  const removedFormality = FORMAL_MARKERS.filter(
    (marker) => originalLower.includes(marker) && !finalLower.includes(marker),
  );
  if (removedFormality.length > 0) {
    signals.push({ kind: "formality_removed", detail: removedFormality.join(", ") });
  }

  if (/[.!]$/.test(original) && !/[.!?]$/.test(final)) {
    signals.push({ kind: "terminal_punctuation_stripped" });
  }

  if (final.length <= original.length * 0.7 && original.length - final.length >= 10) {
    signals.push({ kind: "shortened" });
  } else if (original.length <= final.length * 0.7 && final.length - original.length >= 10) {
    signals.push({ kind: "lengthened" });
  }

  const originalEmoji = EMOJI_PATTERN.test(original);
  const finalEmoji = EMOJI_PATTERN.test(final);
  if (!originalEmoji && finalEmoji) signals.push({ kind: "emoji_added" });
  if (originalEmoji && !finalEmoji) signals.push({ kind: "emoji_removed" });

  const originalBangs = original.includes("!");
  const finalBangs = final.includes("!");
  if (!originalBangs && finalBangs) signals.push({ kind: "exclamation_added" });
  if (originalBangs && !finalBangs) signals.push({ kind: "exclamation_removed" });

  const originalOptions = countTimeExpressions(original);
  const finalOptions = countTimeExpressions(final);
  if (originalOptions > 1 && finalOptions < originalOptions && finalOptions > 0) {
    signals.push({
      kind: "option_count_reduced",
      detail: `${originalOptions}->${finalOptions}`,
    });
  }

  const originalFormat = timeFormat(original);
  const finalFormat = timeFormat(final);
  if (originalFormat !== "none" && finalFormat !== "none" && originalFormat !== finalFormat) {
    signals.push({ kind: "time_format_changed", detail: finalFormat });
  }

  const originalFirst = firstLetter(original);
  const finalFirst = firstLetter(final);
  if (originalFirst !== undefined && finalFirst !== undefined) {
    const originalUpper =
      originalFirst === originalFirst.toUpperCase() && originalFirst !== originalFirst.toLowerCase();
    const finalUpper =
      finalFirst === finalFirst.toUpperCase() && finalFirst !== finalFirst.toLowerCase();
    if (originalUpper && !finalUpper) signals.push({ kind: "lowercased" });
    if (!originalUpper && finalUpper) signals.push({ kind: "capitalized" });
  }

  return signals;
}

/**
 * fold one observed signal into the profile. immutable — returns a new profile.
 * an opposing signal resets the opposite streak, so only consistent behavior
 * ever reaches the activation threshold.
 */
export function accumulatePreference(existing: StyleProfile, signal: StyleEditSignal): StyleProfile {
  const next: StyleProfile = { ...existing };

  const current = next[signal.kind] ?? { observations: 0, active: false };
  const observations = current.observations + 1;
  next[signal.kind] = {
    observations,
    active: observations >= PREFERENCE_ACTIVATION_THRESHOLD,
  };

  const opposite = OPPOSITES[signal.kind];
  if (opposite !== undefined && next[opposite] !== undefined) {
    next[opposite] = { observations: 0, active: false };
  }

  return next;
}

/** wipe everything learned */
export function resetStyleProfile(): StyleProfile {
  return {};
}
