import type { WorkingHours } from "@soon/shared-types";

/** epoch-ms interval matching the scheduling engine's shape */
export type BusyInterval = { start: number; end: number };

export const NINE_TO_SIX_WEEKDAYS: WorkingHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  start: "09:00",
  end: "18:00",
}));

/** build a busy interval from ISO instants */
export function busy(startIso: string, endIso: string): BusyInterval {
  return { start: Date.parse(startIso), end: Date.parse(endIso) };
}

/** a fully-booked week (nyc time, 2026-07-20..24, 9-6 every day) */
export const FULLY_BOOKED_WEEK: BusyInterval[] = [
  busy("2026-07-20T13:00:00Z", "2026-07-20T22:00:00Z"),
  busy("2026-07-21T13:00:00Z", "2026-07-21T22:00:00Z"),
  busy("2026-07-22T13:00:00Z", "2026-07-22T22:00:00Z"),
  busy("2026-07-23T13:00:00Z", "2026-07-23T22:00:00Z"),
  busy("2026-07-24T13:00:00Z", "2026-07-24T22:00:00Z"),
];

/** a normal week: some meetings scattered */
export const SCATTERED_WEEK: BusyInterval[] = [
  busy("2026-07-20T14:00:00Z", "2026-07-20T15:00:00Z"),
  busy("2026-07-21T17:00:00Z", "2026-07-21T18:30:00Z"),
  busy("2026-07-23T13:00:00Z", "2026-07-23T14:00:00Z"),
];
