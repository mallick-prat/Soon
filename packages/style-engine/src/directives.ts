import type { RelationshipType } from "@soon/shared-types";
import type { StyleFeatures } from "./features.js";

const RELATIONSHIP_TONE: Record<RelationshipType, string> = {
  close_friend: "tone: casual and warm, like texting a good friend.",
  family: "tone: casual and warm.",
  casual_acquaintance: "tone: light and friendly.",
  colleague: "tone: relaxed and direct.",
  founder: "tone: friendly and efficient.",
  investor: "tone: warm but polished.",
  mentor: "tone: respectful and warm.",
  professional_contact: "tone: friendly and professional.",
  unknown: "tone: neutral and friendly.",
};

/** relationships whose default (used only when conversation data is thin) leans polished */
const POLISHED_DEFAULT = new Set<RelationshipType>([
  "investor",
  "mentor",
  "professional_contact",
  "founder",
  "colleague",
]);

/** enough observed messages for conversation features to dominate the relationship default */
const FEATURE_DOMINANCE_THRESHOLD = 3;

/**
 * compact writing directives for the llm prompt. the current conversation's
 * observed features always win over the relationship default; the relationship
 * only sets tone and fills gaps when there's too little data.
 */
export function styleDirectives(features: StyleFeatures, relationship: RelationshipType): string {
  const directives: string[] = [];
  const hasSignal = features.messageCount >= FEATURE_DOMINANCE_THRESHOLD;

  if (features.messageCount > 0 && features.lowercaseStyle) {
    directives.push("write in all lowercase.");
  } else if (features.messageCount > 0) {
    directives.push("use normal sentence casing.");
  } else if (POLISHED_DEFAULT.has(relationship)) {
    directives.push("use normal sentence casing.");
  } else {
    directives.push("lowercase is fine.");
  }

  directives.push("keep it under 2 short sentences.");

  if (hasSignal || features.messageCount > 0) {
    if (!features.usesTerminalPeriod) directives.push("no period at the end.");
    if (!features.usesExclamations) directives.push("no exclamation marks.");
    else directives.push("an occasional exclamation mark is fine.");
    if (!features.usesEmoji) directives.push("no emoji.");
  } else {
    directives.push("no exclamation marks.");
    directives.push("no emoji.");
  }

  if (features.avgMessageLength > 0 && features.avgMessageLength < 60) {
    directives.push("keep it brief — this person texts short.");
  }

  if (features.acknowledgments.length > 0) {
    directives.push(
      `natural confirmations for this person: ${features.acknowledgments.slice(0, 3).join(", ")}.`,
    );
  }

  if (features.usesAbbreviations) {
    directives.push(
      `abbreviations are natural here (${features.abbreviations.slice(0, 4).join(", ")}).`,
    );
  }

  if (features.timeFormatHint === "compact") {
    directives.push("write times like 3pm, not 3:00 pm.");
  } else if (features.timeFormatHint === "padded") {
    directives.push("write times like 3:00 pm.");
  }

  directives.push(RELATIONSHIP_TONE[relationship]);
  directives.push("no em dashes. no lists. never sound like an assistant.");

  return directives.join(" ");
}
