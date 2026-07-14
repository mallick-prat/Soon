import type { PreferredWindow } from "@soon/shared-types";
import type { Interval } from "./intervals.js";
import { localDateKey, localTimeToInstant, localWeekday } from "./windows.js";

export type ScoringContext = {
  timezone: string;
  preferredWindows: PreferredWindow[];
  /** normalized busy intervals (unpadded) for spacing analysis */
  busy: Interval[];
  now: number;
  /** count of existing meetings per local date key */
  meetingsPerDay: Record<string, number>;
  /** additive bonus applied when the slot matches conversation date hints */
  contextMatchDates?: Set<string> | undefined;
  travelRequired: boolean;
};

const HOUR = 3_600_000;

export function scoreSlot(slot: Interval, ctx: ScoringContext): number {
  return (
    preferredDayScore(slot, ctx) +
    preferredTimeScore(slot, ctx) +
    contextMatchScore(slot, ctx) +
    calendarSpacingScore(slot, ctx) -
    fragmentedDayPenalty(slot, ctx) -
    lateNoticePenalty(slot, ctx) -
    travelRiskPenalty(slot, ctx)
  );
}

/** lighter days score higher */
function preferredDayScore(slot: Interval, ctx: ScoringContext): number {
  const key = localDateKey(slot.start, ctx.timezone);
  const load = ctx.meetingsPerDay[key] ?? 0;
  return Math.max(0, 3 - load) * 0.5;
}

/** bonus when the slot falls inside a preferred window */
function preferredTimeScore(slot: Interval, ctx: ScoringContext): number {
  const weekday = localWeekday(slot.start, ctx.timezone);
  const dateKey = localDateKey(slot.start, ctx.timezone);
  let score = 0;
  for (const w of ctx.preferredWindows) {
    if (w.weekday !== weekday) continue;
    const start = localTimeToInstant(dateKey, w.start, ctx.timezone);
    const end = localTimeToInstant(dateKey, w.end, ctx.timezone);
    if (slot.start >= start && slot.end <= end) score += 2 * (w.weight ?? 1);
  }
  return score;
}

/** bonus when the slot lands on a date the conversation pointed at */
function contextMatchScore(slot: Interval, ctx: ScoringContext): number {
  if (!ctx.contextMatchDates?.size) return 0;
  return ctx.contextMatchDates.has(localDateKey(slot.start, ctx.timezone)) ? 3 : 0;
}

/**
 * reward slots adjacent to existing meetings (keeps the calendar packed)
 * without being adjacent on both sides.
 */
function calendarSpacingScore(slot: Interval, ctx: ScoringContext): number {
  let adjacentBefore = false;
  let adjacentAfter = false;
  for (const b of ctx.busy) {
    if (Math.abs(slot.start - b.end) <= 30 * 60_000) adjacentBefore = true;
    if (Math.abs(b.start - slot.end) <= 30 * 60_000) adjacentAfter = true;
  }
  if (adjacentBefore || adjacentAfter) return 1;
  return 0;
}

/**
 * penalize slots that split a large free block into two awkward fragments,
 * e.g. a 30-minute meeting dropped in the middle of a free afternoon.
 */
function fragmentedDayPenalty(slot: Interval, ctx: ScoringContext): number {
  let prevEnd = -Infinity;
  let nextStart = Infinity;
  for (const b of ctx.busy) {
    if (b.end <= slot.start) prevEnd = Math.max(prevEnd, b.end);
    if (b.start >= slot.end) nextStart = Math.min(nextStart, b.start);
  }
  const gapBefore = slot.start - prevEnd;
  const gapAfter = nextStart - slot.end;
  const fragmented =
    gapBefore > HOUR && gapBefore < 3 * HOUR && gapAfter > HOUR && gapAfter < 3 * HOUR;
  return fragmented ? 1.5 : 0;
}

/** penalize slots very close to now */
function lateNoticePenalty(slot: Interval, ctx: ScoringContext): number {
  const noticeHours = (slot.start - ctx.now) / HOUR;
  if (noticeHours < 4) return 2;
  if (noticeHours < 12) return 1;
  return 0;
}

/** penalize in-person slots tightly sandwiched between other meetings */
function travelRiskPenalty(slot: Interval, ctx: ScoringContext): number {
  if (!ctx.travelRequired) return 0;
  for (const b of ctx.busy) {
    const gapBefore = slot.start - b.end;
    const gapAfter = b.start - slot.end;
    if ((gapBefore >= 0 && gapBefore < HOUR) || (gapAfter >= 0 && gapAfter < HOUR)) return 1.5;
  }
  return 0;
}
