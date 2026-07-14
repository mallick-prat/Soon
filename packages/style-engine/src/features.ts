/**
 * deterministic scheduling-style feature extraction from USER-AUTHORED
 * messages only. no llm involvement anywhere in this package.
 */

export type TimeFormatHint = "compact" | "padded" | "unknown";

export interface StyleFeatures {
  messageCount: number;
  /** lowercase letters / all cased letters across messages */
  lowercaseRatio: number;
  /** messages starting with a lowercase letter / messages starting with a letter */
  startsLowercaseRatio: number;
  /** derived: the user texts in lowercase */
  lowercaseStyle: boolean;
  avgMessageLength: number;
  /** majority of messages end with a terminal period */
  usesTerminalPeriod: boolean;
  /** exclamation marks per message */
  exclamationRate: number;
  usesExclamations: boolean;
  /** fraction of messages containing at least one emoji */
  emojiRate: number;
  usesEmoji: boolean;
  /** confirmation phrases the user actually uses, most frequent first */
  acknowledgments: string[];
  /** day/time abbreviations the user actually uses (thurs, tues, …) */
  abbreviations: string[];
  usesAbbreviations: boolean;
  /** "compact" = 3pm, "padded" = 3:00 pm */
  timeFormatHint: TimeFormatHint;
}

export const ACKNOWLEDGMENT_CANDIDATES = [
  "sounds good",
  "sounds great",
  "works for me",
  "that works",
  "works",
  "perfect",
  "great",
  "cool",
  "awesome",
  "sure",
  "okay",
  "ok",
  "yep",
  "yup",
  "sgtm",
  "see you then",
  "let's do it",
] as const;

const ABBREVIATION_CANDIDATES = [
  "mon",
  "tues",
  "tue",
  "weds",
  "wed",
  "thurs",
  "thur",
  "thu",
  "fri",
  "sat",
  "sun",
  "tmrw",
  "tmr",
  "wk",
  "hr",
  "hrs",
  "mins",
] as const;

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const COMPACT_TIME = /\b\d{1,2}\s?(?:am|pm)\b/gi;
const PADDED_TIME = /\b\d{1,2}:\d{2}\s?(?:am|pm)?\b/gi;

function countMatches(text: string, pattern: RegExp): number {
  return text.match(new RegExp(pattern.source, pattern.flags))?.length ?? 0;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phrasePattern(phrase: string): RegExp {
  return new RegExp(`(?<![a-z])${escapeRegExp(phrase)}(?![a-z])`, "i");
}

export function extractStyleFeatures(userMessages: string[]): StyleFeatures {
  const messages = userMessages.map((m) => m.trim()).filter((m) => m.length > 0);
  const messageCount = messages.length;

  let lowercaseLetters = 0;
  let casedLetters = 0;
  let startsWithLetter = 0;
  let startsLowercase = 0;
  let totalLength = 0;
  let terminalPeriods = 0;
  let exclamations = 0;
  let emojiMessages = 0;
  let compactTimes = 0;
  let paddedTimes = 0;
  const ackCounts = new Map<string, number>();
  const abbreviationsFound = new Set<string>();

  for (const message of messages) {
    totalLength += message.length;

    for (const ch of message) {
      if (ch !== ch.toUpperCase()) {
        lowercaseLetters += 1;
        casedLetters += 1;
      } else if (ch !== ch.toLowerCase()) {
        casedLetters += 1;
      }
    }

    const firstLetter = /\p{L}/u.exec(message)?.[0];
    if (firstLetter !== undefined) {
      startsWithLetter += 1;
      if (firstLetter === firstLetter.toLowerCase() && firstLetter !== firstLetter.toUpperCase()) {
        startsLowercase += 1;
      }
    }

    if (/\.$/.test(message) && !/\.\.\.$/.test(message)) terminalPeriods += 1;
    exclamations += countMatches(message, /!/g);
    if (EMOJI_PATTERN.test(message)) emojiMessages += 1;
    compactTimes += countMatches(message, COMPACT_TIME);
    paddedTimes += countMatches(message, PADDED_TIME);

    for (const candidate of ACKNOWLEDGMENT_CANDIDATES) {
      if (phrasePattern(candidate).test(message)) {
        ackCounts.set(candidate, (ackCounts.get(candidate) ?? 0) + 1);
      }
    }
    for (const candidate of ABBREVIATION_CANDIDATES) {
      if (phrasePattern(candidate).test(message)) {
        abbreviationsFound.add(candidate);
      }
    }
  }

  const lowercaseRatio = casedLetters > 0 ? lowercaseLetters / casedLetters : 1;
  const startsLowercaseRatio = startsWithLetter > 0 ? startsLowercase / startsWithLetter : 1;
  const exclamationRate = messageCount > 0 ? exclamations / messageCount : 0;
  const emojiRate = messageCount > 0 ? emojiMessages / messageCount : 0;

  const acknowledgments = [...ackCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([phrase]) => phrase);

  let timeFormatHint: TimeFormatHint = "unknown";
  if (compactTimes > paddedTimes) timeFormatHint = "compact";
  else if (paddedTimes > compactTimes) timeFormatHint = "padded";

  return {
    messageCount,
    lowercaseRatio,
    startsLowercaseRatio,
    lowercaseStyle:
      messageCount > 0 && startsLowercaseRatio >= 0.66 && lowercaseRatio >= 0.85,
    avgMessageLength: messageCount > 0 ? totalLength / messageCount : 0,
    usesTerminalPeriod: messageCount > 0 && terminalPeriods / messageCount > 0.5,
    exclamationRate,
    usesExclamations: exclamationRate > 0,
    emojiRate,
    usesEmoji: emojiRate > 0,
    acknowledgments,
    abbreviations: [...abbreviationsFound],
    usesAbbreviations: abbreviationsFound.size > 0,
    timeFormatHint,
  };
}
