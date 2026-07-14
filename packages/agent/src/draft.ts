import type { DraftObjective, RelationshipType } from "@soon/shared-types";
import { validateDraftText, type StyleFeatures, type ValidateDraftOptions } from "@soon/style-engine";
import type { LanguageModel } from "ai";
import * as chrono from "chrono-node";
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";
import { NoValidDraftError, type RejectedDraft } from "./errors.js";
import { generateStructured } from "./generate.js";

/** structured slot the llm may reference — only via the label we format here */
export interface SlotRef {
  id: string;
  /** ISO instant */
  startsAt: string;
  /** ISO instant */
  endsAt: string;
  /** IANA display timezone */
  timezone: string;
}

export interface DraftMessageRequest {
  objective: DraftObjective;
  slots: SlotRef[];
  relationship: RelationshipType;
  /** from style-engine styleDirectives() */
  styleDirectives: string;
  styleFeatures?: StyleFeatures;
  /** small set of user-authored examples, already sanitized by the caller */
  styleExamples?: string[];
  attendeeName?: string;
  userFirstName?: string;
  /** IANA timezone used as the chrono reference for validation */
  userTimezone: string;
  /** reference "now" (defaults to the wall clock) */
  now?: Date;
  allowLists?: boolean;
  /** extra factual context, e.g. the constraint being asked about */
  extraContext?: string;
}

export interface DraftMessageResult {
  drafts: string[];
  rejected: RejectedDraft[];
}

const draftCandidatesSchema = z.object({
  candidates: z.array(z.string()).min(1).max(3),
});

/** deterministic, chrono-parseable label — the only time words the llm may use */
export function formatSlotLabel(slot: SlotRef): string {
  const start = new Date(slot.startsAt);
  const day = formatInTimeZone(start, slot.timezone, "EEEE MMMM d");
  const time = formatInTimeZone(start, slot.timezone, "h:mmaaa");
  return `${day} at ${time}`.toLowerCase();
}

const TIME_MATCH_TOLERANCE_MS = 30 * 60 * 1000;

function localDateKey(instantMs: number, timezone: string): string {
  return formatInTimeZone(new Date(instantMs), timezone, "yyyy-MM-dd");
}

/**
 * every date/time expression a candidate contains must resolve to one of the
 * provided slots (±30min for "around 3" phrasings). anything else is the llm
 * inventing availability, which is never allowed.
 */
export function verifyDraftTimes(
  text: string,
  slots: SlotRef[],
  now: Date,
  timezone: string,
): { ok: true } | { ok: false; reason: string } {
  const results = chrono.parse(text, { instant: now, timezone }, { forwardDate: true });

  for (const result of results) {
    // chrono types end as optional but yields null at runtime
    const expressions = [result.start, ...(result.end != null ? [result.end] : [])];
    for (const components of expressions) {
      const parsedMs = components.date().getTime();

      // chrono always fills an implied hour; only a certain hour is a real time claim
      if (components.isCertain("hour")) {
        // meridiem guessing: an uncertain "9" may mean 9am or 9pm
        const instants = components.isCertain("meridiem")
          ? [parsedMs]
          : [parsedMs, parsedMs + 12 * 3_600_000, parsedMs - 12 * 3_600_000];
        const matched = slots.some((slot) => {
          const slotEdges = [Date.parse(slot.startsAt), Date.parse(slot.endsAt)];
          return instants.some((t) =>
            slotEdges.some((edge) => Math.abs(t - edge) <= TIME_MATCH_TOLERANCE_MS),
          );
        });
        if (!matched) {
          return {
            ok: false,
            reason: `references a time outside the proposed slots: "${result.text}"`,
          };
        }
      } else {
        // date-level reference ("thursday") must at least be a proposed slot's day
        const matched = slots.some(
          (slot) =>
            localDateKey(parsedMs, slot.timezone) ===
            localDateKey(Date.parse(slot.startsAt), slot.timezone),
        );
        if (!matched) {
          return {
            ok: false,
            reason: `references a day outside the proposed slots: "${result.text}"`,
          };
        }
      }
    }
  }

  return { ok: true };
}

function normalizeForDedupe(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function styleOptions(req: DraftMessageRequest): ValidateDraftOptions {
  const options: ValidateDraftOptions = {};
  if (req.allowLists !== undefined) options.allowLists = req.allowLists;
  if (req.userFirstName !== undefined) options.userFirstName = req.userFirstName;
  return options;
}

/** deterministic post-validation pipeline shared by draftMessage and regenerate */
export function validateCandidates(
  candidates: string[],
  req: DraftMessageRequest,
  previouslySent: string[] = [],
): DraftMessageResult {
  const now = req.now ?? new Date();
  const drafts: string[] = [];
  const rejected: RejectedDraft[] = [];
  const seen = new Set(previouslySent.map(normalizeForDedupe));

  for (const raw of candidates) {
    const text = raw.trim();

    const timeCheck = verifyDraftTimes(text, req.slots, now, req.userTimezone);
    if (!timeCheck.ok) {
      rejected.push({ text, reason: timeCheck.reason });
      continue;
    }

    const styleCheck = validateDraftText(text, req.styleFeatures, styleOptions(req));
    if (!styleCheck.ok) {
      rejected.push({ text, reason: `style: ${styleCheck.violations.join("; ")}` });
      continue;
    }

    const key = normalizeForDedupe(text);
    if (seen.has(key)) {
      rejected.push({ text, reason: "near-duplicate of another candidate" });
      continue;
    }
    seen.add(key);
    drafts.push(text);
  }

  if (drafts.length === 0) {
    throw new NoValidDraftError(rejected);
  }
  return { drafts, rejected };
}

const DRAFT_SYSTEM = [
  "you ghostwrite one short imessage text in the user's own voice.",
  "you are the user; never reveal or imply any assistant exists.",
  "when referring to dates or times you must copy the provided slot labels (light rewording of the same day+time is ok, e.g. \"tuesday at 3pm\").",
  "never mention any day, date, or time that is not one of the provided slots.",
  "you do not decide availability; the slots are already decided.",
  "produce up to 3 alternative candidate texts.",
].join(" ");

function renderDraftPrompt(req: DraftMessageRequest, previous?: string[]): string {
  const lines: string[] = [];
  lines.push(`objective: ${req.objective}`);
  if (req.attendeeName !== undefined) lines.push(`texting with: ${req.attendeeName}`);
  lines.push(`relationship: ${req.relationship}`);
  if (req.slots.length > 0) {
    lines.push("slots you may reference (labels are the only allowed time words):");
    for (const slot of req.slots) lines.push(`- ${formatSlotLabel(slot)}`);
  } else {
    lines.push("no slots to reference — do not mention any specific day or time.");
  }
  if (req.extraContext !== undefined) lines.push(`context: ${req.extraContext}`);
  lines.push(`style directives: ${req.styleDirectives}`);
  if (req.styleExamples !== undefined && req.styleExamples.length > 0) {
    lines.push("examples of how the user texts:");
    for (const example of req.styleExamples) lines.push(`- ${example}`);
  }
  if (previous !== undefined && previous.length > 0) {
    lines.push("previously sent or shown drafts (do not repeat):");
    for (const p of previous) lines.push(`- ${p}`);
    lines.push(
      "produce a meaningfully different structure: fewer options, a question form, or a broader framing — but exactly the same slots.",
    );
  }
  return lines.join("\n");
}

/** up to 3 validated candidate texts for the objective */
export async function draftMessage(
  llm: LanguageModel,
  req: DraftMessageRequest,
): Promise<DraftMessageResult> {
  const { candidates } = await generateStructured({
    model: llm,
    schema: draftCandidatesSchema,
    schemaName: "draft_candidates",
    system: DRAFT_SYSTEM,
    prompt: renderDraftPrompt(req),
  });
  return validateCandidates(candidates, req);
}

/**
 * a structurally different retake after the first message didn't land —
 * never different availability, same validation.
 */
export async function regenerateAlternative(
  llm: LanguageModel,
  req: DraftMessageRequest,
  previous: string[],
): Promise<DraftMessageResult> {
  const { candidates } = await generateStructured({
    model: llm,
    schema: draftCandidatesSchema,
    schemaName: "draft_candidates",
    system: DRAFT_SYSTEM,
    prompt: renderDraftPrompt(req, previous),
  });
  return validateCandidates(candidates, req, previous);
}
