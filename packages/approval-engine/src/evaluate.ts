import {
  CONFIDENCE_REVIEW_THRESHOLD,
  type ApprovalBundle,
  type ApprovalBundleStatus,
  type CandidateSlot,
  type DraftObjective,
  type OutboundDraft,
  type ParsedIntent,
  type ParsedSchedulingMessage,
} from "@soon/shared-types";

export type BundleBoundaryReason =
  | { type: "bundle_not_active"; status: ApprovalBundleStatus }
  | { type: "bundle_expired" }
  | { type: "message_limit_reached" }
  | { type: "objective_not_allowed"; objective: DraftObjective }
  | { type: "slot_not_approved"; slotIds: string[] }
  | { type: "slot_date_outside_range"; slotIds: string[] }
  | { type: "duration_outside_range"; durationMinutes: number }
  | { type: "participant_not_approved"; participantIds: string[] }
  | { type: "confidence_below_threshold"; confidence: number }
  | { type: "sensitive_session" }
  | { type: "requires_user_judgment" }
  | { type: "intent_requires_review"; intent: ParsedIntent }
  | { type: "boundary_flagged"; reason: string };

export type BundleEvaluation =
  | { allowed: true }
  | { allowed: false; boundaryReasons: BundleBoundaryReason[] };

export interface EvaluateDraftContext {
  now: Date;
  parsed?: ParsedSchedulingMessage;
  proposedSlots?: readonly CandidateSlot[];
  durationMinutes?: number;
  participantIds?: readonly string[];
  sensitive?: boolean;
}

export interface EvaluateDraftInput {
  draft: OutboundDraft;
  bundle: ApprovalBundle;
  context: EvaluateDraftContext;
}

/** objectives whose referenced slot ids must be pre-approved */
const SLOT_SCOPED_OBJECTIVES: readonly DraftObjective[] = [
  "propose_slots",
  "confirm_time",
  "confirm_invite",
];

/** parsed intents that always pause for private user review */
const REVIEW_INTENTS: readonly ParsedIntent[] = [
  "add_attendee",
  "reschedule",
  "cancel",
  "sensitive",
  "unrelated",
  "ambiguous",
];

function localDateOf(instant: string, timezone: string): string {
  // en-ca formats as yyyy-mm-dd, directly comparable to iso dates
  return new Intl.DateTimeFormat("en-ca", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

export function evaluateDraftAgainstBundle(input: EvaluateDraftInput): BundleEvaluation {
  const { draft, bundle, context } = input;
  const reasons: BundleBoundaryReason[] = [];

  if (context.sensitive === true) {
    reasons.push({ type: "sensitive_session" });
  }

  if (bundle.status !== "active") {
    reasons.push({ type: "bundle_not_active", status: bundle.status });
  }
  if (context.now.getTime() >= new Date(bundle.expiresAt).getTime()) {
    reasons.push({ type: "bundle_expired" });
  }
  if (bundle.messagesUsed >= bundle.maximumOutboundMessages) {
    reasons.push({ type: "message_limit_reached" });
  }

  if (!(bundle.allowedObjectives as readonly string[]).includes(draft.objective)) {
    reasons.push({ type: "objective_not_allowed", objective: draft.objective });
  }

  if (SLOT_SCOPED_OBJECTIVES.includes(draft.objective)) {
    const approvedSlots = new Set(bundle.approvedSlotIds);
    const unapproved = draft.referencedSlotIds.filter((id) => !approvedSlots.has(id));
    if (unapproved.length > 0) {
      reasons.push({ type: "slot_not_approved", slotIds: unapproved });
    }
  }

  if (context.proposedSlots !== undefined) {
    const outsideRange = context.proposedSlots
      .filter((slot) => {
        const date = localDateOf(slot.startsAt, slot.timezone);
        return date < bundle.approvedDateRangeStart || date > bundle.approvedDateRangeEnd;
      })
      .map((slot) => slot.id);
    if (outsideRange.length > 0) {
      reasons.push({ type: "slot_date_outside_range", slotIds: outsideRange });
    }
  }

  if (
    context.durationMinutes !== undefined &&
    (context.durationMinutes < bundle.minimumDurationMinutes ||
      context.durationMinutes > bundle.maximumDurationMinutes)
  ) {
    reasons.push({ type: "duration_outside_range", durationMinutes: context.durationMinutes });
  }

  if (context.participantIds !== undefined) {
    const approvedParticipants = new Set(bundle.approvedParticipantIds);
    const newcomers = context.participantIds.filter((id) => !approvedParticipants.has(id));
    if (newcomers.length > 0) {
      reasons.push({ type: "participant_not_approved", participantIds: newcomers });
    }
  }

  if (draft.confidence < CONFIDENCE_REVIEW_THRESHOLD) {
    reasons.push({ type: "confidence_below_threshold", confidence: draft.confidence });
  }

  const parsed = context.parsed;
  if (parsed !== undefined) {
    if (parsed.requiresUserJudgment) {
      reasons.push({ type: "requires_user_judgment" });
    }
    if (REVIEW_INTENTS.includes(parsed.intent)) {
      reasons.push({ type: "intent_requires_review", intent: parsed.intent });
    }
    if (parsed.bundleBoundaryReason !== undefined) {
      reasons.push({ type: "boundary_flagged", reason: parsed.bundleBoundaryReason });
    }
  }

  return reasons.length === 0 ? { allowed: true } : { allowed: false, boundaryReasons: reasons };
}
