import { randomUUID } from "node:crypto";
import type { CandidateSlot, OutboundDraft, SchedulingSession } from "@soon/shared-types";
import { evaluateDraftAgainstBundle } from "@soon/approval-engine";
import type {
  AvailabilityService,
  Clock,
  CommandDispatcher,
  Interpreter,
  SessionStore,
} from "./ports.js";
import { bundleStatusFor, meetingContextFor } from "./approval-request.js";

export type ConfirmDeps = {
  store: SessionStore;
  availability: AvailabilityService;
  interpreter: Interpreter;
  dispatcher: CommandDispatcher;
  clock: Clock;
};

const DRAFT_TTL_MS = 6 * 3_600_000;

/**
 * confirm the accepted slot and create the calendar event.
 * calendar creation reflecting a clear agreement may run automatically —
 * but the slot is rechecked immediately before insertion, and creation is
 * idempotent (keyed on session + slot). afterward soon drafts the
 * confirmation message ("perfect just sent it") — auto-sent inside a bundle,
 * otherwise parked for approval — and privately notifies the user.
 */
export async function confirmAndCreateEvent(
  deps: ConfirmDeps,
  session: SchedulingSession,
  accepted: CandidateSlot,
  attendee: { email: string; firstName: string },
  conversationId: string,
  conversationReference: string,
  styleExamples: string[] = [],
): Promise<{ outcome: "created"; eventId: string } | { outcome: "slot_taken" }> {
  await deps.store.transition(session.id, "confirming_slot");

  const stillFree = await deps.availability.slotStillFree(session.userId, {
    start: Date.parse(accepted.startsAt),
    end: Date.parse(accepted.endsAt),
  });
  if (!stillFree) {
    await deps.store.markSlotsStatus(session.id, [accepted.id], "stale");
    await deps.store.transition(session.id, "finding_alternative_slots", {
      reason: "slot_taken_before_booking",
    });
    return { outcome: "slot_taken" };
  }

  await deps.store.transition(session.id, "creating_event");

  const title = session.sensitive
    ? `meeting with ${attendee.firstName.toLowerCase()}`
    : `catch up with ${attendee.firstName.toLowerCase()}`;

  const { eventId } = await deps.availability.createEvent({
    userId: session.userId,
    sessionId: session.id,
    conversationId,
    idempotencyKey: `event:${session.id}:${accepted.id}`,
    startIso: accepted.startsAt,
    endIso: accepted.endsAt,
    timezone: accepted.timezone,
    attendeeEmail: attendee.email,
    title: session.title ?? title,
    location: session.meetingFormat === "in_person" ? session.location : undefined,
    wantsMeet: session.meetingFormat === "virtual",
  });

  await deps.store.markSlotsStatus(session.id, [accepted.id], "booked");
  await deps.store.audit(session.id, "calendar_event_created", "soon", { eventId });
  await deps.store.transition(session.id, "drafting_confirmation", { eventId });

  // draft the confirmation message for the conversation ("just sent it").
  const now = deps.clock.now();
  const drafted = await deps.interpreter.draft({
    sessionId: session.id,
    objective: "confirm_invite",
    slots: [],
    styleExamples,
  });
  const draft: OutboundDraft = {
    id: randomUUID(),
    sessionId: session.id,
    objective: "confirm_invite",
    text: drafted.text,
    alternativeTexts: drafted.alternatives,
    referencedSlotIds: [],
    confidence: drafted.confidence,
    requiresApproval: true,
    expiresAt: new Date(now.getTime() + DRAFT_TTL_MS).toISOString(),
  };

  const bundle = await deps.store.getActiveBundle(session.id);
  if (bundle && !session.sensitive) {
    const verdict = evaluateDraftAgainstBundle({
      draft,
      bundle,
      context: {
        now,
        proposedSlots: [],
        durationMinutes: session.durationMinutes,
        sensitive: session.sensitive,
      },
    });
    if (verdict.allowed) {
      draft.requiresApproval = false;
      draft.approvalBundleId = bundle.id;
    }
  }
  await deps.store.saveDraft(draft);

  if (!draft.requiresApproval && draft.approvalBundleId) {
    await deps.dispatcher.enqueueSend({
      userId: session.userId,
      sessionId: session.id,
      conversationReference,
      draftId: draft.id,
      text: draft.text,
      approvalSource: "bundle",
      idempotencyKey: `send:${draft.id}`,
      expiresAtIso: draft.expiresAt,
    });
    await deps.store.audit(session.id, "confirmation_sent_via_bundle", "soon", { draftId: draft.id });
  } else {
    await deps.dispatcher.enqueueApprovalRequest({
      userId: session.userId,
      sessionId: session.id,
      conversationReference,
      draftId: draft.id,
      text: draft.text,
      meetingContext: meetingContextFor(session),
      candidateTimes: [],
      whySelected: "",
      bundleStatus: bundleStatusFor(bundle),
      idempotencyKey: `approve:${draft.id}`,
      expiresAtIso: draft.expiresAt,
    });
    await deps.store.audit(session.id, "confirmation_requires_approval", "soon", { draftId: draft.id });
  }

  // the meeting is booked — the session is scheduled regardless of the
  // confirmation message's approval state (which the outbox / drafts track).
  await deps.store.transition(session.id, "scheduled", { eventId });

  // private notification to the user (never sent into the conversation).
  const when = formatSlotForNotification(accepted);
  await deps.dispatcher.notify(
    session.userId,
    `scheduled with ${attendee.firstName.toLowerCase()}`,
    when,
    ["open event", "done"],
  );

  return { outcome: "created", eventId };
}

function formatSlotForNotification(slot: CandidateSlot): string {
  const start = new Date(slot.startsAt);
  const end = new Date(slot.endsAt);
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
    timeZone: slot.timezone,
  }).format(start);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: slot.timezone,
  });
  return `${day} · ${time.format(start)}–${time.format(end)}`.toLowerCase();
}
