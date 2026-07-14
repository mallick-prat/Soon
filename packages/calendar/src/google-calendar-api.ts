import { google } from "googleapis";
import type { calendar_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type {
  CalendarApi,
  FreeBusyCalendarResult,
  RawCalendarListEntry,
  RawConferenceData,
  RawEvent,
  RawEventTime,
} from "./types.js";

/** convert googleapis' `T | null | undefined` fields to this package's `T | undefined`. */
function orUndefined<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

function mapEventTime(
  time: calendar_v3.Schema$EventDateTime | null | undefined,
): RawEventTime | undefined {
  if (time === undefined || time === null) return undefined;
  return {
    dateTime: orUndefined(time.dateTime),
    date: orUndefined(time.date),
    timeZone: orUndefined(time.timeZone),
  };
}

function mapConferenceData(
  data: calendar_v3.Schema$ConferenceData | null | undefined,
): RawConferenceData | undefined {
  if (data === undefined || data === null) return undefined;
  const createRequest = data.createRequest ?? undefined;
  const solutionKey = createRequest?.conferenceSolutionKey ?? undefined;
  return {
    createRequest:
      createRequest === undefined
        ? undefined
        : {
            requestId: orUndefined(createRequest.requestId),
            conferenceSolutionKey:
              solutionKey === undefined ? undefined : { type: orUndefined(solutionKey.type) },
          },
    entryPoints: data.entryPoints?.map((entry) => ({
      entryPointType: orUndefined(entry.entryPointType),
      uri: orUndefined(entry.uri),
    })),
  };
}

function mapPrivateProperties(
  props: calendar_v3.Schema$Event["extendedProperties"],
): { private?: Record<string, string> | undefined } | undefined {
  const priv = props?.private;
  if (priv === undefined || priv === null) return undefined;
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(priv)) {
    if (typeof value === "string") clean[key] = value;
  }
  return { private: clean };
}

export function mapGoogleEvent(event: calendar_v3.Schema$Event): RawEvent {
  return {
    id: orUndefined(event.id),
    status: orUndefined(event.status),
    summary: orUndefined(event.summary),
    description: orUndefined(event.description),
    location: orUndefined(event.location),
    transparency: orUndefined(event.transparency),
    start: mapEventTime(event.start),
    end: mapEventTime(event.end),
    attendees: event.attendees?.map((attendee) => ({
      email: orUndefined(attendee.email),
      responseStatus: orUndefined(attendee.responseStatus),
    })),
    htmlLink: orUndefined(event.htmlLink),
    hangoutLink: orUndefined(event.hangoutLink),
    conferenceData: mapConferenceData(event.conferenceData),
    extendedProperties: mapPrivateProperties(event.extendedProperties),
  };
}

/** production CalendarApi backed by googleapis. all google calendar traffic flows through here. */
export function createGoogleCalendarApi(auth: OAuth2Client): CalendarApi {
  // googleapis bundles its own copy of google-auth-library (nominally distinct classes,
  // runtime-compatible), so the client instance needs an explicit bridge cast.
  const calendar = google.calendar({
    version: "v3",
    auth: auth as unknown as NonNullable<calendar_v3.Options["auth"]>,
  });

  return {
    async queryFreeBusy({ timeMin, timeMax, calendarIds }) {
      const res = await calendar.freebusy.query({
        requestBody: { timeMin, timeMax, items: calendarIds.map((id) => ({ id })) },
      });
      const out: Record<string, FreeBusyCalendarResult> = {};
      for (const [id, entry] of Object.entries(res.data.calendars ?? {})) {
        const busy: { start: string; end: string }[] = [];
        for (const block of entry.busy ?? []) {
          if (typeof block.start === "string" && typeof block.end === "string") {
            busy.push({ start: block.start, end: block.end });
          }
        }
        const errors = entry.errors?.map((e) => ({ reason: orUndefined(e.reason) }));
        out[id] = {
          busy,
          ...(errors !== undefined && errors.length > 0 ? { errors } : {}),
        };
      }
      return out;
    },

    async listEvents(params) {
      const privateExtendedProperty =
        params.privateExtendedProperties === undefined
          ? undefined
          : Object.entries(params.privateExtendedProperties).map(
              ([key, value]) => `${key}=${value}`,
            );
      const res = await calendar.events.list({
        calendarId: params.calendarId,
        ...(params.timeMin !== undefined ? { timeMin: params.timeMin } : {}),
        ...(params.timeMax !== undefined ? { timeMax: params.timeMax } : {}),
        ...(params.singleEvents !== undefined ? { singleEvents: params.singleEvents } : {}),
        ...(params.maxResults !== undefined ? { maxResults: params.maxResults } : {}),
        ...(params.pageToken !== undefined ? { pageToken: params.pageToken } : {}),
        ...(privateExtendedProperty !== undefined ? { privateExtendedProperty } : {}),
      });
      const nextPageToken = orUndefined(res.data.nextPageToken);
      return {
        items: (res.data.items ?? []).map(mapGoogleEvent),
        ...(nextPageToken !== undefined ? { nextPageToken } : {}),
      };
    },

    async insertEvent({ calendarId, requestBody, conferenceDataVersion, sendUpdates }) {
      const res = await calendar.events.insert({
        calendarId,
        requestBody: requestBody as calendar_v3.Schema$Event,
        ...(conferenceDataVersion !== undefined ? { conferenceDataVersion } : {}),
        ...(sendUpdates !== undefined ? { sendUpdates } : {}),
      });
      return mapGoogleEvent(res.data);
    },

    async patchEvent({ calendarId, eventId, requestBody, sendUpdates }) {
      const res = await calendar.events.patch({
        calendarId,
        eventId,
        requestBody: requestBody as calendar_v3.Schema$Event,
        ...(sendUpdates !== undefined ? { sendUpdates } : {}),
      });
      return mapGoogleEvent(res.data);
    },

    async deleteEvent({ calendarId, eventId, sendUpdates }) {
      await calendar.events.delete({
        calendarId,
        eventId,
        ...(sendUpdates !== undefined ? { sendUpdates } : {}),
      });
    },

    async listCalendars() {
      const entries: RawCalendarListEntry[] = [];
      let pageToken: string | undefined;
      do {
        const res = await calendar.calendarList.list({
          ...(pageToken !== undefined ? { pageToken } : {}),
        });
        for (const item of res.data.items ?? []) {
          entries.push({
            id: orUndefined(item.id),
            summary: orUndefined(item.summary),
            accessRole: orUndefined(item.accessRole),
            primary: orUndefined(item.primary),
          });
        }
        pageToken = orUndefined(res.data.nextPageToken);
      } while (pageToken !== undefined);
      return entries;
    },
  };
}
