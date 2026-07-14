import { addDays, isBefore, isEqual } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { WorkingHours } from "@soon/shared-types";
import type { Interval } from "./intervals.js";
import { normalize } from "./intervals.js";

/** local calendar date "yyyy-MM-dd" of an instant in a timezone */
export function localDateKey(instantMs: number, timezone: string): string {
  return formatInTimeZone(instantMs, timezone, "yyyy-MM-dd");
}

/** local weekday (0 = sunday … 6 = saturday) of an instant in a timezone */
export function localWeekday(instantMs: number, timezone: string): number {
  return Number(formatInTimeZone(instantMs, timezone, "i")) % 7;
}

/**
 * convert a local wall-clock time on a local date to an instant.
 * during a DST spring-forward gap, date-fns-tz resolves the nonexistent
 * local time to the instant after the gap, so we never emit a nonexistent time.
 */
export function localTimeToInstant(dateKey: string, hhmm: string, timezone: string): number {
  return fromZonedTime(`${dateKey}T${hhmm}:00`, timezone).getTime();
}

/**
 * build the working-hours windows (as instants) for every local day
 * between rangeStart and rangeEnd inclusive, in the user's timezone.
 */
export function buildWorkingWindows(params: {
  rangeStart: Date;
  rangeEnd: Date;
  timezone: string;
  workingHours: WorkingHours[];
  weekendEnabled: boolean;
  allowedWeekdays?: number[] | undefined;
  excludedDates?: string[] | undefined;
}): Interval[] {
  const { rangeStart, rangeEnd, timezone, workingHours, weekendEnabled } = params;
  const excluded = new Set(params.excludedDates ?? []);
  const allowed = params.allowedWeekdays ? new Set(params.allowedWeekdays) : undefined;
  const byWeekday = new Map<number, WorkingHours[]>();
  for (const wh of workingHours) {
    const list = byWeekday.get(wh.weekday) ?? [];
    list.push(wh);
    byWeekday.set(wh.weekday, list);
  }

  const out: Interval[] = [];
  // walk local days; iterate by adding days to noon UTC of the start date to avoid DST edge drift
  let cursor = new Date(rangeStart);
  const endGuard = addDays(rangeEnd, 1);
  const seen = new Set<string>();
  while (isBefore(cursor, endGuard) || isEqual(cursor, endGuard)) {
    const dateKey = localDateKey(cursor.getTime(), timezone);
    if (!seen.has(dateKey)) {
      seen.add(dateKey);
      const weekdayInstant = localTimeToInstant(dateKey, "12:00", timezone);
      const weekday = localWeekday(weekdayInstant, timezone);
      const isWeekend = weekday === 0 || weekday === 6;
      const dayAllowed =
        !excluded.has(dateKey) &&
        (!allowed || allowed.has(weekday)) &&
        (weekendEnabled || !isWeekend);
      if (dayAllowed) {
        for (const wh of byWeekday.get(weekday) ?? []) {
          const start = localTimeToInstant(dateKey, wh.start, timezone);
          const end = localTimeToInstant(dateKey, wh.end, timezone);
          if (start < end) out.push({ start, end });
        }
      }
    }
    cursor = addDays(cursor, 1);
    if (out.length > 10_000) break; // hard safety bound
  }
  return normalize(out);
}
