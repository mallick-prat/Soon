import {
  CONFIDENCE_REVIEW_THRESHOLD,
  parsedSchedulingMessageSchema,
  type MeetingParameters,
  type ParsedSchedulingMessage,
} from "@soon/shared-types";
import type { LanguageModel } from "ai";
import { generateStructured } from "./generate.js";

export interface ProposedSlotRef {
  id: string;
  /** human label exactly as it appeared in the outbound message */
  label: string;
}

export interface InterpretReplyInput {
  /** the attendee message being interpreted */
  replyText: string;
  /** recent sanitized messages, oldest first */
  recentMessages: { senderType: "user" | "attendee"; text: string }[];
  /** slots proposed in the immediately-preceding outbound message */
  proposedSlots: ProposedSlotRef[];
  lastOutboundText?: string;
  meetingParameters?: MeetingParameters;
}

const SYSTEM = [
  "you classify an attendee's reply in a scheduling text conversation.",
  "map the reply onto the schema. use only what the reply and context actually say.",
  "acceptedSlotId must be one of the listed proposed slot ids, chosen only when the reply unambiguously picks that slot.",
  "never invent times, emails, durations, or locations.",
  "set confidence honestly; when the reply is unclear, use intent \"ambiguous\" and requiresUserJudgment true.",
].join(" ");

function renderReplyPrompt(input: InterpretReplyInput): string {
  const lines: string[] = [];
  if (input.recentMessages.length > 0) {
    lines.push("recent messages (oldest first):");
    for (const m of input.recentMessages) lines.push(`${m.senderType}: ${m.text}`);
  }
  if (input.lastOutboundText !== undefined) {
    lines.push(`last outbound message: ${input.lastOutboundText}`);
  }
  if (input.proposedSlots.length > 0) {
    lines.push("currently proposed slots:");
    for (const slot of input.proposedSlots) lines.push(`- id ${slot.id}: ${slot.label}`);
  } else {
    lines.push("no slots are currently proposed.");
  }
  if (input.meetingParameters !== undefined) {
    const p = input.meetingParameters;
    lines.push(
      `meeting: ${p.meetingType}, ${p.durationMinutes}m, ${p.format}${
        p.locationText !== undefined ? `, ${p.locationText}` : ""
      }`,
    );
  }
  lines.push(`attendee reply to interpret: ${input.replyText}`);
  return lines.join("\n");
}

const BARE_ACCEPTANCES = new Set([
  "yes",
  "yeah",
  "yea",
  "yep",
  "yup",
  "sure",
  "ok",
  "okay",
  "sounds good",
  "sounds great",
  "that works",
  "works",
  "works for me",
  "perfect",
  "great",
  "cool",
  "sgtm",
  "lets do it",
  "im in",
  "down",
]);

/** a yes with no slot-identifying content ("sure", "that works", "sounds good 👍") */
export function isBareAcceptance(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[^a-z ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return BARE_ACCEPTANCES.has(normalized);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** strip surrounding punctuation, then validate syntactically; null when invalid */
export function normalizeEmail(raw: string): string | null {
  const stripped = raw
    .trim()
    .replace(/[)\].,;:!?'"]+$/, "")
    .replace(/^[([<'"]+/, "");
  return EMAIL_PATTERN.test(stripped) ? stripped : null;
}

function downgradeToAmbiguous(
  parsed: ParsedSchedulingMessage,
  reason: string,
): ParsedSchedulingMessage {
  const { acceptedSlotId: _dropped, ...rest } = parsed;
  return {
    ...rest,
    intent: "ambiguous",
    requiresUserJudgment: true,
    bundleBoundaryReason: reason,
  };
}

/**
 * deterministic post-guards over the llm's parse. the llm interprets language;
 * these rules decide what is safe to act on.
 */
export function applyReplyGuards(
  parsed: ParsedSchedulingMessage,
  input: InterpretReplyInput,
): ParsedSchedulingMessage {
  let result: ParsedSchedulingMessage = { ...parsed };

  if (result.intent === "accept_slot") {
    if (isBareAcceptance(input.replyText) && input.proposedSlots.length > 1) {
      result = downgradeToAmbiguous(
        result,
        "bare acceptance while multiple slots were proposed",
      );
    } else if (
      result.acceptedSlotId === undefined ||
      !input.proposedSlots.some((slot) => slot.id === result.acceptedSlotId)
    ) {
      result = downgradeToAmbiguous(result, "accepted slot id is not among the proposed slots");
    }
  }

  if (result.intent === "provide_email") {
    const email = result.email !== undefined ? normalizeEmail(result.email) : null;
    if (email === null) {
      result = downgradeToAmbiguous(result, "reply did not contain a valid email address");
    } else {
      result = { ...result, email };
    }
  }

  if (result.confidence < CONFIDENCE_REVIEW_THRESHOLD) {
    result = { ...result, requiresUserJudgment: true };
  }

  return result;
}

/** interpret an inbound reply, then apply the deterministic guards */
export async function interpretReply(
  llm: LanguageModel,
  input: InterpretReplyInput,
): Promise<ParsedSchedulingMessage> {
  const parsed = await generateStructured({
    model: llm,
    schema: parsedSchedulingMessageSchema,
    schemaName: "parsed_scheduling_message",
    system: SYSTEM,
    prompt: renderReplyPrompt(input),
  });
  return applyReplyGuards(parsed, input);
}
