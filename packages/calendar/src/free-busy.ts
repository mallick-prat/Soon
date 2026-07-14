import { FreeBusyLookupError } from "./errors.js";
import type { CalendarApi, Interval, RawEventTime } from "./types.js";

/** merge overlapping or touching intervals into a sorted, disjoint list. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

export function parseEventTime(time: RawEventTime | undefined): number | null {
  if (time === undefined) return null;
  if (time.dateTime !== undefined) {
    const parsed = Date.parse(time.dateTime);
    return Number.isNaN(parsed) ? null : parsed;
  }
  // all-day events carry only a date with no zone information; interpret at utc midnight.
  if (time.date !== undefined) {
    const parsed = Date.parse(`${time.date}T00:00:00Z`);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export interface GetBusyIntervalsParams {
  calendarIds: string[];
  /** ISO instant */
  timeMin: string;
  /** ISO instant */
  timeMax: string;
}

/**
 * busy intervals via the freebusy api, merged across calendars.
 *
 * LIMITATION: freebusy does not expose event status, so tentative events are always
 * counted as busy here and cannot be filtered out. when the user's `tentativeBlocks`
 * preference is false, use getBusyIntervalsFromEvents instead — it reads the event
 * list and can respect `status` and `transparency`.
 */
export async function getBusyIntervals(
  api: CalendarApi,
  params: GetBusyIntervalsParams,
): Promise<Interval[]> {
  const { calendarIds, timeMin, timeMax } = params;
  if (calendarIds.length === 0) return [];

  const calendars = await api.queryFreeBusy({ timeMin, timeMax, calendarIds });
  const intervals: Interval[] = [];
  for (const calendarId of calendarIds) {
    const result = calendars[calendarId];
    // a missing or errored calendar must not silently read as free — that risks double-booking.
    if (result === undefined) {
      throw new FreeBusyLookupError(calendarId, "calendar missing from freebusy response");
    }
    if (result.errors !== undefined && result.errors.length > 0) {
      throw new FreeBusyLookupError(calendarId, result.errors[0]?.reason);
    }
    for (const block of result.busy) {
      const start = Date.parse(block.start);
      const end = Date.parse(block.end);
      if (!Number.isNaN(start) && !Number.isNaN(end)) {
        intervals.push({ start, end });
      }
    }
  }
  return mergeIntervals(intervals);
}

export interface GetBusyIntervalsFromEventsParams extends GetBusyIntervalsParams {
  /** when false, tentative events do not block availability. */
  tentativeBlocks: boolean;
}

/**
 * busy intervals derived from events.list rather than freebusy, so the
 * `tentativeBlocks` policy and event `transparency` ("free" events) are respected.
 */
export async function getBusyIntervalsFromEvents(
  api: CalendarApi,
  params: GetBusyIntervalsFromEventsParams,
): Promise<Interval[]> {
  const { calendarIds, timeMin, timeMax, tentativeBlocks } = params;
  const windowStart = Date.parse(timeMin);
  const windowEnd = Date.parse(timeMax);
  const intervals: Interval[] = [];

  for (const calendarId of calendarIds) {
    let pageToken: string | undefined;
    do {
      const page = await api.listEvents({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true, // expand recurring events into instances
        maxResults: 2500,
        pageToken,
      });
      for (const event of page.items) {
        if (event.status === "cancelled") continue;
        if (event.transparency === "transparent") continue; // marked "free"
        if (!tentativeBlocks && event.status === "tentative") continue;
        const start = parseEventTime(event.start);
        const end = parseEventTime(event.end);
        if (start === null || end === null) continue;
        const clippedStart = Math.max(start, windowStart);
        const clippedEnd = Math.min(end, windowEnd);
        if (clippedEnd > clippedStart) {
          intervals.push({ start: clippedStart, end: clippedEnd });
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined);
  }
  return mergeIntervals(intervals);
}
