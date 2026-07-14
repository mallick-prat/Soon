import { NotSoonEventError } from "./errors.js";
import {
  SOON_CONVERSATION_ID_PROP,
  SOON_IDEMPOTENCY_KEY_PROP,
  SOON_SESSION_ID_PROP,
  mapRawEvent,
} from "./types.js";
import type { CalendarApi, RawEvent, SoonEvent } from "./types.js";

/**
 * default, attendee-visible event title. system language ("soon", "ai", "assistant")
 * must never appear in attendee-visible fields — titles read as if the user wrote them.
 */
export function defaultEventTitle(
  firstName: string,
  opts?: { sensitive?: boolean | undefined },
): string {
  const name = firstName.trim().toLowerCase();
  const base = opts?.sensitive === true ? "meeting" : "catch up";
  return name === "" ? base : `${base} with ${name}`;
}

export interface CreateEventInput {
  calendarId: string;
  /** ISO instant */
  startIso: string;
  /** ISO instant */
  endIso: string;
  /** IANA timezone */
  timezone: string;
  attendeeEmail: string;
  title: string;
  /** blank by default — never auto-filled with system language. */
  description?: string | undefined;
  /** in-person location text, verbatim from the user. never invented. */
  location?: string | undefined;
  wantsMeet: boolean;
  sessionId: string;
  conversationId: string;
  idempotencyKey: string;
}

export interface CreateEventResult {
  event: SoonEvent;
  /** true when an existing event with the same idempotency key was returned instead of inserting. */
  deduplicated: boolean;
}

/**
 * idempotent event creation. system identifiers ride only in private extended
 * properties (invisible to attendees); a pre-insert lookup on soonIdempotencyKey
 * makes retries safe — "query before retrying insertion".
 */
export async function createEvent(
  api: CalendarApi,
  input: CreateEventInput,
): Promise<CreateEventResult> {
  const existing = await findEventByIdempotencyKey(api, {
    calendarId: input.calendarId,
    idempotencyKey: input.idempotencyKey,
  });
  if (existing !== null) {
    return { event: existing, deduplicated: true };
  }

  const requestBody: RawEvent = {
    summary: input.title,
    description: input.description ?? "",
    start: { dateTime: input.startIso, timeZone: input.timezone },
    end: { dateTime: input.endIso, timeZone: input.timezone },
    attendees: [{ email: input.attendeeEmail }],
    extendedProperties: {
      private: {
        [SOON_SESSION_ID_PROP]: input.sessionId,
        [SOON_CONVERSATION_ID_PROP]: input.conversationId,
        [SOON_IDEMPOTENCY_KEY_PROP]: input.idempotencyKey,
      },
    },
  };
  if (input.location !== undefined && input.location !== "") {
    requestBody.location = input.location;
  }
  if (input.wantsMeet) {
    // the deterministic requestId makes conference creation idempotent on google's side too.
    requestBody.conferenceData = {
      createRequest: {
        requestId: input.idempotencyKey,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const inserted = await api.insertEvent({
    calendarId: input.calendarId,
    requestBody,
    sendUpdates: "all", // the attendee must receive the invitation
    // google silently drops conferenceData unless conferenceDataVersion is 1.
    ...(input.wantsMeet ? { conferenceDataVersion: 1 } : {}),
  });
  return { event: mapRawEvent(inserted, input.calendarId), deduplicated: false };
}

export interface FindEventBySessionParams {
  calendarId: string;
  sessionId: string;
}

/** locate the live event for a session — used for retry reconciliation. */
export async function findEventBySession(
  api: CalendarApi,
  params: FindEventBySessionParams,
): Promise<SoonEvent | null> {
  return findByPrivateProperty(api, params.calendarId, SOON_SESSION_ID_PROP, params.sessionId);
}

export interface FindEventByIdempotencyKeyParams {
  calendarId: string;
  idempotencyKey: string;
}

/** locate the live event for an idempotency key — query before retrying insertion. */
export async function findEventByIdempotencyKey(
  api: CalendarApi,
  params: FindEventByIdempotencyKeyParams,
): Promise<SoonEvent | null> {
  return findByPrivateProperty(
    api,
    params.calendarId,
    SOON_IDEMPOTENCY_KEY_PROP,
    params.idempotencyKey,
  );
}

async function findByPrivateProperty(
  api: CalendarApi,
  calendarId: string,
  key: string,
  value: string,
): Promise<SoonEvent | null> {
  const { items } = await api.listEvents({
    calendarId,
    privateExtendedProperties: { [key]: value },
  });
  const live = items.find((event) => event.status !== "cancelled");
  return live === undefined ? null : mapRawEvent(live, calendarId);
}

export interface UpdateEventInput {
  calendarId: string;
  eventId: string;
  /** session the event must be linked to via private extended properties. */
  sessionId: string;
  startIso: string;
  endIso: string;
  timezone: string;
}

/** reschedule a soon-created event. throws NotSoonEventError if the event is not linked to the session. */
export async function updateEvent(api: CalendarApi, input: UpdateEventInput): Promise<SoonEvent> {
  await requireSoonEvent(api, input.calendarId, input.eventId, input.sessionId);
  const patched = await api.patchEvent({
    calendarId: input.calendarId,
    eventId: input.eventId,
    requestBody: {
      start: { dateTime: input.startIso, timeZone: input.timezone },
      end: { dateTime: input.endIso, timeZone: input.timezone },
    },
    sendUpdates: "all",
  });
  return mapRawEvent(patched, input.calendarId);
}

export interface CancelEventInput {
  calendarId: string;
  eventId: string;
  sessionId: string;
}

/** cancel a soon-created event. throws NotSoonEventError if the event is not linked to the session. */
export async function cancelEvent(api: CalendarApi, input: CancelEventInput): Promise<void> {
  await requireSoonEvent(api, input.calendarId, input.eventId, input.sessionId);
  await api.deleteEvent({
    calendarId: input.calendarId,
    eventId: input.eventId,
    sendUpdates: "all",
  });
}

/**
 * ownership guard: the event must be discoverable via its private soonSessionId
 * property AND match the target id. verified through events.list with a
 * privateExtendedProperty filter, so a foreign event can never satisfy it.
 */
async function requireSoonEvent(
  api: CalendarApi,
  calendarId: string,
  eventId: string,
  sessionId: string,
): Promise<RawEvent> {
  const { items } = await api.listEvents({
    calendarId,
    privateExtendedProperties: { [SOON_SESSION_ID_PROP]: sessionId },
  });
  const match = items.find((event) => event.id === eventId);
  if (match === undefined) {
    throw new NotSoonEventError(calendarId, eventId);
  }
  return match;
}
