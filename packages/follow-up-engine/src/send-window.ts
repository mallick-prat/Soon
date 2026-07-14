import { addDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type { QuietHours } from "@soon/shared-types";

interface WallClock {
  hours: number;
  minutes: number;
}

function parseWallClock(value: string): WallClock {
  const [h = "0", m = "0"] = value.split(":");
  return { hours: Number(h), minutes: Number(m) };
}

function atWallClock(zoned: Date, wall: WallClock): Date {
  const next = new Date(zoned);
  next.setHours(wall.hours, wall.minutes, 0, 0);
  return next;
}

function isWeekend(zoned: Date): boolean {
  const day = zoned.getDay();
  return day === 0 || day === 6;
}

/**
 * returns the same instant when it falls inside the allowed send window
 * ([earliest, latest) local wall-clock, weekdays only unless weekends are
 * enabled), otherwise the next allowed moment. wall-clock math runs in the
 * contact's timezone so dst transitions cannot shift the send hour.
 */
export function adjustForSendWindow(
  instant: Date,
  quietHours: Pick<QuietHours, "earliest" | "latest">,
  weekendsEnabled: boolean,
  timezone: string,
): Date {
  const earliest = parseWallClock(quietHours.earliest);
  const latest = parseWallClock(quietHours.latest);
  const earliestMinutes = earliest.hours * 60 + earliest.minutes;
  const latestMinutes = latest.hours * 60 + latest.minutes;

  let zoned = toZonedTime(instant, timezone);
  let deferred = false;

  // at most two weekend days plus one quiet-hour rollover need skipping
  for (let guard = 0; guard < 8; guard += 1) {
    if (!weekendsEnabled && isWeekend(zoned)) {
      zoned = atWallClock(addDays(zoned, 1), earliest);
      deferred = true;
      continue;
    }
    const wallMinutes = zoned.getHours() * 60 + zoned.getMinutes();
    if (wallMinutes < earliestMinutes) {
      zoned = atWallClock(zoned, earliest);
      deferred = true;
      break; // same allowed day, now at the window opening
    }
    if (wallMinutes >= latestMinutes) {
      zoned = atWallClock(addDays(zoned, 1), earliest);
      deferred = true;
      continue; // next day may be a weekend — re-check
    }
    break;
  }

  return deferred ? fromZonedTime(zoned, timezone) : instant;
}
