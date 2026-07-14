import type {
  AvailabilityConstraints,
  MeetingFormat,
  PreferredWindow,
  WorkingHours,
} from "@soon/shared-types";
import type { Interval } from "./intervals.js";
import { durationMs, intersect, normalize, pad, subtract } from "./intervals.js";
import { buildWorkingWindows, localDateKey } from "./windows.js";
import { scoreSlot, type ScoringContext } from "./score.js";

const MINUTE = 60_000;
/** candidate starts align to quarter hours */
const GRID_MINUTES = 15;

export type SlotGenerationInput = {
  rangeStart: Date;
  rangeEnd: Date;
  durationMinutes: number;
  timezone: string;
  now: Date;
  /** busy intervals across all blocking calendars, epoch ms */
  busy: Interval[];
  workingHours: WorkingHours[];
  preferredWindows?: PreferredWindow[];
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  minimumNoticeMinutes?: number;
  maximumMeetingsPerDay?: number;
  /** meetings already on the calendar per local date key "yyyy-MM-dd" */
  meetingsPerDay?: Record<string, number>;
  /** slots the attendee already rejected — never re-offer */
  rejectedSlots?: Interval[];
  attendeeConstraints?: AvailabilityConstraints;
  weekendEnabled?: boolean;
  format?: MeetingFormat;
  travelBufferMinutes?: number;
  /** local dates hinted by the conversation ("yyyy-MM-dd") — scored up */
  contextMatchDates?: string[];
  maxCandidates?: number;
};

export type GeneratedSlot = Interval & {
  score: number;
  timezone: string;
};

/**
 * deterministic candidate generation:
 * working windows − busy(±buffers) − notice − rejected − attendee constraints,
 * stepped on a 15-minute grid, scored, then diversified.
 */
export function generateCandidateSlots(input: SlotGenerationInput): GeneratedSlot[] {
  const {
    timezone,
    durationMinutes,
    maxCandidates = 3,
    bufferBeforeMinutes = 0,
    bufferAfterMinutes = 0,
    minimumNoticeMinutes = 0,
    maximumMeetingsPerDay = Infinity,
    meetingsPerDay = {},
    format = "unspecified",
    travelBufferMinutes = 0,
  } = input;

  const inPerson = format === "in_person";
  // in-person meetings reserve travel time on both sides
  const beforeMs = (bufferBeforeMinutes + (inPerson ? travelBufferMinutes : 0)) * MINUTE;
  const afterMs = (bufferAfterMinutes + (inPerson ? travelBufferMinutes : 0)) * MINUTE;

  let free = buildWorkingWindows({
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
    timezone,
    workingHours: input.workingHours,
    weekendEnabled: input.weekendEnabled ?? false,
    allowedWeekdays: input.attendeeConstraints?.allowedWeekdays,
    excludedDates: input.attendeeConstraints?.excludedDates,
  });

  // a new meeting needs `bufferBefore` clearance after prior busy time and
  // `bufferAfter` clearance before the next busy block, so pad busy by
  // (after at each start, before at each end) — i.e. mirror the margins.
  const busy = normalize(input.busy);
  free = subtract(free, pad(busy, afterMs === 0 ? 0 : afterMs, beforeMs === 0 ? 0 : beforeMs));

  // minimum notice: nothing before now + notice
  const noticeFloor = input.now.getTime() + minimumNoticeMinutes * MINUTE;
  free = subtract(free, [{ start: -8.64e15, end: noticeFloor }]);

  // attendee time windows constrain, attendee date range constrains
  if (input.attendeeConstraints?.timeWindows?.length) {
    const windows = input.attendeeConstraints.timeWindows
      .map((w) => ({ start: Date.parse(w.start), end: Date.parse(w.end) }))
      .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end));
    if (windows.length) free = intersect(free, windows);
  }
  if (input.attendeeConstraints?.earliestDate) {
    const t = Date.parse(input.attendeeConstraints.earliestDate);
    if (Number.isFinite(t)) free = subtract(free, [{ start: -8.64e15, end: t }]);
  }
  if (input.attendeeConstraints?.latestDate) {
    // latestDate is an inclusive local date; cut at its end of day in tz
    const endOfDay = Date.parse(input.attendeeConstraints.latestDate) + 48 * 3_600_000;
    free = free.map((f) => ({ start: f.start, end: Math.min(f.end, endOfDay) })).filter((f) => f.start < f.end);
  }

  // never re-offer rejected slots
  if (input.rejectedSlots?.length) {
    free = subtract(free, input.rejectedSlots);
  }

  const slotMs = durationMinutes * MINUTE;
  const gridMs = GRID_MINUTES * MINUTE;
  const ctx: ScoringContext = {
    timezone,
    preferredWindows: input.preferredWindows ?? [],
    busy,
    now: input.now.getTime(),
    meetingsPerDay,
    contextMatchDates: input.contextMatchDates ? new Set(input.contextMatchDates) : undefined,
    travelRequired: inPerson,
  };

  const scored: GeneratedSlot[] = [];
  for (const window of free) {
    if (durationMs(window) < slotMs) continue;
    // align first start up to the grid
    let start = Math.ceil(window.start / gridMs) * gridMs;
    for (; start + slotMs <= window.end; start += gridMs) {
      const dayKey = localDateKey(start, timezone);
      if ((meetingsPerDay[dayKey] ?? 0) >= maximumMeetingsPerDay) continue;
      const slot: Interval = { start, end: start + slotMs };
      scored.push({ ...slot, timezone, score: scoreSlot(slot, ctx) });
    }
  }

  return pickDiverse(scored, maxCandidates, timezone);
}

/**
 * pick top candidates that are meaningfully different:
 * prefer distinct days, and never offer adjacent times on the same day.
 */
export function pickDiverse(
  slots: GeneratedSlot[],
  count: number,
  timezone: string,
): GeneratedSlot[] {
  const sorted = slots.slice().sort((a, b) => b.score - a.score || a.start - b.start);
  const picked: GeneratedSlot[] = [];

  const tooClose = (a: GeneratedSlot, b: GeneratedSlot) =>
    localDateKey(a.start, timezone) === localDateKey(b.start, timezone) &&
    Math.abs(a.start - b.start) < 3 * 3_600_000;

  // pass 1: distinct days only
  for (const s of sorted) {
    if (picked.length >= count) break;
    if (picked.some((p) => localDateKey(p.start, timezone) === localDateKey(s.start, timezone)))
      continue;
    picked.push(s);
  }
  // pass 2: allow same-day picks that are not adjacent
  for (const s of sorted) {
    if (picked.length >= count) break;
    if (picked.includes(s)) continue;
    if (picked.some((p) => tooClose(p, s))) continue;
    picked.push(s);
  }
  return picked.sort((a, b) => a.start - b.start);
}

/**
 * revalidate a chosen slot against fresh busy data immediately before booking.
 */
export function slotStillAvailable(slot: Interval, freshBusy: Interval[]): boolean {
  return subtract([slot], freshBusy).some(
    (i) => i.start === slot.start && i.end === slot.end,
  );
}
