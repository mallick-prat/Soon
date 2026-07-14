/**
 * epoch ms, end exclusive — mirrors the scheduling engine's interval shape.
 * defined locally on purpose; this package must not import scheduling-engine.
 */
export interface Interval {
  start: number;
  end: number;
}

/**
 * private extended-property keys used to tag events soon creates.
 * these live in `extendedProperties.private` and are invisible to attendees —
 * the ONLY place system identifiers are allowed on an event.
 */
export const SOON_SESSION_ID_PROP = "soonSessionId";
export const SOON_CONVERSATION_ID_PROP = "soonConversationId";
export const SOON_IDEMPOTENCY_KEY_PROP = "soonIdempotencyKey";

/** google calendar event date/time — dateTime for timed events, date for all-day. */
export interface RawEventTime {
  dateTime?: string | undefined;
  date?: string | undefined;
  timeZone?: string | undefined;
}

export interface RawEventAttendee {
  email?: string | undefined;
  responseStatus?: string | undefined;
}

export interface RawConferenceData {
  createRequest?:
    | {
        requestId?: string | undefined;
        conferenceSolutionKey?: { type?: string | undefined } | undefined;
      }
    | undefined;
  entryPoints?:
    | { entryPointType?: string | undefined; uri?: string | undefined }[]
    | undefined;
}

/** the subset of a google calendar event this package reads and writes. */
export interface RawEvent {
  id?: string | undefined;
  status?: string | undefined;
  summary?: string | undefined;
  description?: string | undefined;
  location?: string | undefined;
  /** "transparent" means the event does not block time ("free"). */
  transparency?: string | undefined;
  start?: RawEventTime | undefined;
  end?: RawEventTime | undefined;
  attendees?: RawEventAttendee[] | undefined;
  htmlLink?: string | undefined;
  hangoutLink?: string | undefined;
  conferenceData?: RawConferenceData | undefined;
  extendedProperties?: { private?: Record<string, string> | undefined } | undefined;
}

export interface RawCalendarListEntry {
  id?: string | undefined;
  summary?: string | undefined;
  accessRole?: string | undefined;
  primary?: boolean | undefined;
}

export interface FreeBusyCalendarResult {
  busy: { start: string; end: string }[];
  errors?: { reason?: string | undefined }[] | undefined;
}

export type SendUpdates = "all" | "externalOnly" | "none";

export interface ListEventsParams {
  calendarId: string;
  timeMin?: string | undefined;
  timeMax?: string | undefined;
  /** each entry becomes a `privateExtendedProperty=key=value` filter; all must match. */
  privateExtendedProperties?: Record<string, string> | undefined;
  singleEvents?: boolean | undefined;
  maxResults?: number | undefined;
  pageToken?: string | undefined;
}

/**
 * the narrow surface of the google calendar api this package uses.
 * production adapts googleapis (see google-calendar-api.ts); tests use an in-memory fake.
 */
export interface CalendarApi {
  queryFreeBusy(params: {
    timeMin: string;
    timeMax: string;
    calendarIds: string[];
  }): Promise<Record<string, FreeBusyCalendarResult>>;
  listEvents(
    params: ListEventsParams,
  ): Promise<{ items: RawEvent[]; nextPageToken?: string | undefined }>;
  insertEvent(params: {
    calendarId: string;
    requestBody: RawEvent;
    /** must be 1 for google to honor conferenceData.createRequest. */
    conferenceDataVersion?: number | undefined;
    sendUpdates?: SendUpdates | undefined;
  }): Promise<RawEvent>;
  patchEvent(params: {
    calendarId: string;
    eventId: string;
    requestBody: RawEvent;
    sendUpdates?: SendUpdates | undefined;
  }): Promise<RawEvent>;
  deleteEvent(params: {
    calendarId: string;
    eventId: string;
    sendUpdates?: SendUpdates | undefined;
  }): Promise<void>;
  listCalendars(): Promise<RawCalendarListEntry[]>;
}

export type SoonEventStatus = "confirmed" | "tentative" | "cancelled";

/** normalized view of an event soon created (or read back for reconciliation). */
export interface SoonEvent {
  eventId: string;
  calendarId: string;
  status: SoonEventStatus;
  summary: string;
  /** ISO instant (or all-day date) as returned by google */
  start: string;
  end: string;
  timezone?: string;
  location?: string;
  meetLink?: string;
  htmlLink?: string;
  sessionId?: string;
  conversationId?: string;
  idempotencyKey?: string;
}

/** calendar entry shaped for onboarding calendar selection. */
export interface CalendarListing {
  id: string;
  summary: string;
  writable: boolean;
  primary: boolean;
}

export function mapRawEvent(raw: RawEvent, calendarId: string): SoonEvent {
  if (raw.id === undefined || raw.id === "") {
    throw new Error("calendar event is missing an id");
  }
  const priv = raw.extendedProperties?.private ?? {};
  const sessionId = priv[SOON_SESSION_ID_PROP];
  const conversationId = priv[SOON_CONVERSATION_ID_PROP];
  const idempotencyKey = priv[SOON_IDEMPOTENCY_KEY_PROP];
  const timezone = raw.start?.timeZone;
  const status: SoonEventStatus =
    raw.status === "tentative" || raw.status === "cancelled" ? raw.status : "confirmed";

  return {
    eventId: raw.id,
    calendarId,
    status,
    summary: raw.summary ?? "",
    start: raw.start?.dateTime ?? raw.start?.date ?? "",
    end: raw.end?.dateTime ?? raw.end?.date ?? "",
    ...(timezone !== undefined ? { timezone } : {}),
    ...(raw.location !== undefined ? { location: raw.location } : {}),
    ...(raw.hangoutLink !== undefined ? { meetLink: raw.hangoutLink } : {}),
    ...(raw.htmlLink !== undefined ? { htmlLink: raw.htmlLink } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(conversationId !== undefined ? { conversationId } : {}),
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
  };
}
