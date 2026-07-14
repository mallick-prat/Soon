import { parseEventTime } from "./free-busy.js";
import type {
  CalendarApi,
  FreeBusyCalendarResult,
  ListEventsParams,
  RawCalendarListEntry,
  RawEvent,
  SendUpdates,
} from "./types.js";

export interface RecordedInsert {
  calendarId: string;
  requestBody: RawEvent;
  conferenceDataVersion?: number | undefined;
  sendUpdates?: SendUpdates | undefined;
}

export interface RecordedPatch {
  calendarId: string;
  eventId: string;
  requestBody: RawEvent;
  sendUpdates?: SendUpdates | undefined;
}

export interface RecordedDelete {
  calendarId: string;
  eventId: string;
  sendUpdates?: SendUpdates | undefined;
}

/**
 * in-memory CalendarApi for unit tests. mirrors the google behaviors this package
 * depends on: freebusy cannot distinguish tentative events, conferenceData is
 * dropped unless conferenceDataVersion is 1, and cancelled events are hidden
 * from events.list (showDeleted defaults to false).
 */
export class FakeCalendarApi implements CalendarApi {
  private nextId = 1;
  private readonly eventsByCalendar = new Map<string, RawEvent[]>();
  calendars: RawCalendarListEntry[] = [];
  /** calendarId -> error reason returned by queryFreeBusy for that calendar. */
  freeBusyErrors: Record<string, string> = {};

  readonly inserts: RecordedInsert[] = [];
  readonly patches: RecordedPatch[] = [];
  readonly deletes: RecordedDelete[] = [];

  seedEvent(calendarId: string, event: RawEvent): RawEvent {
    const stored: RawEvent = { id: `seed_${this.nextId++}`, status: "confirmed", ...event };
    this.calendarEvents(calendarId).push(stored);
    return stored;
  }

  private calendarEvents(calendarId: string): RawEvent[] {
    let events = this.eventsByCalendar.get(calendarId);
    if (events === undefined) {
      events = [];
      this.eventsByCalendar.set(calendarId, events);
    }
    return events;
  }

  async queryFreeBusy(params: {
    timeMin: string;
    timeMax: string;
    calendarIds: string[];
  }): Promise<Record<string, FreeBusyCalendarResult>> {
    const windowStart = Date.parse(params.timeMin);
    const windowEnd = Date.parse(params.timeMax);
    const out: Record<string, FreeBusyCalendarResult> = {};
    for (const calendarId of params.calendarIds) {
      const errorReason = this.freeBusyErrors[calendarId];
      if (errorReason !== undefined) {
        out[calendarId] = { busy: [], errors: [{ reason: errorReason }] };
        continue;
      }
      const busy: { start: string; end: string }[] = [];
      for (const event of this.calendarEvents(calendarId)) {
        // like google's freebusy: transparent events are free, but tentative
        // events are indistinguishable from confirmed ones.
        if (event.status === "cancelled") continue;
        if (event.transparency === "transparent") continue;
        const start = parseEventTime(event.start);
        const end = parseEventTime(event.end);
        if (start === null || end === null) continue;
        const clippedStart = Math.max(start, windowStart);
        const clippedEnd = Math.min(end, windowEnd);
        if (clippedEnd > clippedStart) {
          busy.push({
            start: new Date(clippedStart).toISOString(),
            end: new Date(clippedEnd).toISOString(),
          });
        }
      }
      out[calendarId] = { busy };
    }
    return out;
  }

  async listEvents(
    params: ListEventsParams,
  ): Promise<{ items: RawEvent[]; nextPageToken?: string | undefined }> {
    const windowStart = params.timeMin === undefined ? null : Date.parse(params.timeMin);
    const windowEnd = params.timeMax === undefined ? null : Date.parse(params.timeMax);
    const items = this.calendarEvents(params.calendarId).filter((event) => {
      if (event.status === "cancelled") return false;
      if (params.privateExtendedProperties !== undefined) {
        const priv = event.extendedProperties?.private ?? {};
        for (const [key, value] of Object.entries(params.privateExtendedProperties)) {
          if (priv[key] !== value) return false;
        }
      }
      if (windowStart !== null || windowEnd !== null) {
        const start = parseEventTime(event.start);
        const end = parseEventTime(event.end);
        if (start === null || end === null) return false;
        if (windowEnd !== null && start >= windowEnd) return false;
        if (windowStart !== null && end <= windowStart) return false;
      }
      return true;
    });
    return { items: items.map((event) => ({ ...event })) };
  }

  async insertEvent(params: {
    calendarId: string;
    requestBody: RawEvent;
    conferenceDataVersion?: number | undefined;
    sendUpdates?: SendUpdates | undefined;
  }): Promise<RawEvent> {
    this.inserts.push({ ...params });
    const id = `evt_${this.nextId++}`;
    const event: RawEvent = {
      ...params.requestBody,
      id,
      status: "confirmed",
      htmlLink: `https://calendar.example/${id}`,
    };
    if (
      params.requestBody.conferenceData?.createRequest !== undefined &&
      params.conferenceDataVersion === 1
    ) {
      event.hangoutLink = `https://meet.google.com/fake-${id}`;
    } else {
      // google silently drops conferenceData when conferenceDataVersion is not 1.
      delete event.conferenceData;
    }
    this.calendarEvents(params.calendarId).push(event);
    return { ...event };
  }

  async patchEvent(params: {
    calendarId: string;
    eventId: string;
    requestBody: RawEvent;
    sendUpdates?: SendUpdates | undefined;
  }): Promise<RawEvent> {
    this.patches.push({ ...params });
    const event = this.calendarEvents(params.calendarId).find((e) => e.id === params.eventId);
    if (event === undefined) {
      throw new Error(`fake calendar: event ${params.eventId} not found`);
    }
    Object.assign(event, params.requestBody);
    return { ...event };
  }

  async deleteEvent(params: {
    calendarId: string;
    eventId: string;
    sendUpdates?: SendUpdates | undefined;
  }): Promise<void> {
    this.deletes.push({ ...params });
    const event = this.calendarEvents(params.calendarId).find((e) => e.id === params.eventId);
    if (event === undefined) {
      throw new Error(`fake calendar: event ${params.eventId} not found`);
    }
    event.status = "cancelled";
  }

  async listCalendars(): Promise<RawCalendarListEntry[]> {
    return this.calendars.map((entry) => ({ ...entry }));
  }
}
