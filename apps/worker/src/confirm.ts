import type { CandidateSlot, SchedulingSession } from "@soon/shared-types";
import type { AvailabilityService, Clock, CommandDispatcher, SessionStore } from "./ports.js";

export type ConfirmDeps = {
  store: SessionStore;
  availability: AvailabilityService;
  dispatcher: CommandDispatcher;
  clock: Clock;
};

/**
 * confirm the accepted slot and create the calendar event.
 * calendar creation reflecting a clear agreement may run automatically —
 * but the slot is rechecked immediately before insertion, and creation is
 * idempotent (keyed on session + slot).
 */
export async function confirmAndCreateEvent(
  deps: ConfirmDeps,
  session: SchedulingSession,
  accepted: CandidateSlot,
  attendee: { email: string; firstName: string },
  conversationId: string,
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
