import { describe, expect, it } from "vitest";
import type { WorkingHours } from "@soon/shared-types";
import { generateCandidateSlots, slotStillAvailable, type SlotGenerationInput } from "./generate.js";
import { localDateKey, localTimeToInstant } from "./windows.js";
import { overlaps } from "./intervals.js";

const TZ = "America/New_York";
const WORKDAYS: WorkingHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  start: "09:00",
  end: "18:00",
}));

// monday 2026-07-20 .. friday 2026-07-24, "now" = friday before at noon
const NOW = new Date(localTimeToInstant("2026-07-17", "12:00", TZ));

function baseInput(overrides: Partial<SlotGenerationInput> = {}): SlotGenerationInput {
  return {
    rangeStart: new Date(localTimeToInstant("2026-07-20", "00:00", TZ)),
    rangeEnd: new Date(localTimeToInstant("2026-07-24", "12:00", TZ)),
    durationMinutes: 30,
    timezone: TZ,
    now: NOW,
    busy: [],
    workingHours: WORKDAYS,
    ...overrides,
  };
}

describe("generateCandidateSlots", () => {
  it("returns up to three candidates inside working hours", () => {
    const slots = generateCandidateSlots(baseInput());
    expect(slots.length).toBe(3);
    for (const s of slots) {
      const dateKey = localDateKey(s.start, TZ);
      expect(s.start).toBeGreaterThanOrEqual(localTimeToInstant(dateKey, "09:00", TZ));
      expect(s.end).toBeLessThanOrEqual(localTimeToInstant(dateKey, "18:00", TZ));
      expect(s.end - s.start).toBe(30 * 60_000);
    }
  });

  it("prefers distinct days for diversity", () => {
    const slots = generateCandidateSlots(baseInput());
    const days = new Set(slots.map((s) => localDateKey(s.start, TZ)));
    expect(days.size).toBe(3);
  });

  it("never overlaps busy time", () => {
    const busy = [
      // monday fully booked
      { start: localTimeToInstant("2026-07-20", "09:00", TZ), end: localTimeToInstant("2026-07-20", "18:00", TZ) },
      { start: localTimeToInstant("2026-07-21", "10:00", TZ), end: localTimeToInstant("2026-07-21", "16:00", TZ) },
    ];
    const slots = generateCandidateSlots(baseInput({ busy }));
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      for (const b of busy) expect(overlaps(s, b)).toBe(false);
    }
  });

  it("respects buffers around meetings", () => {
    const busy = [
      { start: localTimeToInstant("2026-07-20", "12:00", TZ), end: localTimeToInstant("2026-07-20", "13:00", TZ) },
    ];
    const slots = generateCandidateSlots(
      baseInput({ busy, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 }),
    );
    for (const s of slots) {
      if (localDateKey(s.start, TZ) !== "2026-07-20") continue;
      // must not start within 15m after the meeting ends nor end within 15m before it starts
      expect(
        s.end <= localTimeToInstant("2026-07-20", "11:45", TZ) ||
          s.start >= localTimeToInstant("2026-07-20", "13:15", TZ),
      ).toBe(true);
    }
  });

  it("enforces minimum notice", () => {
    const now = new Date(localTimeToInstant("2026-07-20", "09:00", TZ));
    const slots = generateCandidateSlots(baseInput({ now, minimumNoticeMinutes: 240 }));
    for (const s of slots) {
      expect(s.start).toBeGreaterThanOrEqual(now.getTime() + 240 * 60_000);
    }
  });

  it("never offers rejected slots again", () => {
    const first = generateCandidateSlots(baseInput());
    const rejected = first.map((s) => ({ start: s.start, end: s.end }));
    const second = generateCandidateSlots(baseInput({ rejectedSlots: rejected }));
    for (const s of second) {
      for (const r of rejected) expect(overlaps(s, r)).toBe(false);
    }
  });

  it("skips days at the meetings-per-day limit", () => {
    const slots = generateCandidateSlots(
      baseInput({
        maximumMeetingsPerDay: 2,
        meetingsPerDay: { "2026-07-20": 2, "2026-07-21": 2, "2026-07-22": 2 },
      }),
    );
    for (const s of slots) {
      expect(["2026-07-23", "2026-07-24"]).toContain(localDateKey(s.start, TZ));
    }
  });

  it("excludes weekends by default and includes them when enabled", () => {
    const input = baseInput({
      rangeStart: new Date(localTimeToInstant("2026-07-18", "00:00", TZ)), // saturday
      rangeEnd: new Date(localTimeToInstant("2026-07-19", "23:59", TZ)), // sunday
      workingHours: [0, 6].map((weekday) => ({ weekday, start: "10:00", end: "16:00" })),
    });
    expect(generateCandidateSlots(input)).toEqual([]);
    expect(generateCandidateSlots({ ...input, weekendEnabled: true }).length).toBeGreaterThan(0);
  });

  it("applies attendee weekday constraints", () => {
    const slots = generateCandidateSlots(
      baseInput({ attendeeConstraints: { allowedWeekdays: [4] } }), // thursday only
    );
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(localDateKey(s.start, TZ)).toBe("2026-07-23");
    }
  });

  it("reserves travel buffers for in-person meetings", () => {
    const busy = [
      { start: localTimeToInstant("2026-07-20", "12:00", TZ), end: localTimeToInstant("2026-07-20", "13:00", TZ) },
    ];
    const slots = generateCandidateSlots(
      baseInput({ busy, format: "in_person", travelBufferMinutes: 30 }),
    );
    for (const s of slots) {
      if (localDateKey(s.start, TZ) !== "2026-07-20") continue;
      expect(
        s.end <= localTimeToInstant("2026-07-20", "11:30", TZ) ||
          s.start >= localTimeToInstant("2026-07-20", "13:30", TZ),
      ).toBe(true);
    }
  });

  it("boosts dates hinted by the conversation", () => {
    const slots = generateCandidateSlots(baseInput({ contextMatchDates: ["2026-07-22"] }));
    expect(slots.map((s) => localDateKey(s.start, TZ))).toContain("2026-07-22");
  });

  it("handles a DST spring-forward day without emitting nonexistent times", () => {
    // US DST: 2026-03-08, 2:00 -> 3:00 am in America/New_York
    const slots = generateCandidateSlots(
      baseInput({
        rangeStart: new Date(localTimeToInstant("2026-03-08", "00:00", TZ)),
        rangeEnd: new Date(localTimeToInstant("2026-03-09", "23:00", TZ)),
        now: new Date(localTimeToInstant("2026-03-06", "12:00", TZ)),
        workingHours: [0, 1].map((weekday) => ({ weekday, start: "01:00", end: "05:00" })),
        weekendEnabled: true,
      }),
    );
    // every produced instant must be a real time
    for (const s of slots) {
      expect(Number.isFinite(s.start)).toBe(true);
      expect(s.end - s.start).toBe(30 * 60_000);
    }
  });
});

describe("slotStillAvailable", () => {
  it("accepts a free slot and rejects a newly taken one", () => {
    const slot = { start: 1000, end: 2000 };
    expect(slotStillAvailable(slot, [])).toBe(true);
    expect(slotStillAvailable(slot, [{ start: 1500, end: 1600 }])).toBe(false);
    expect(slotStillAvailable(slot, [{ start: 2000, end: 3000 }])).toBe(true);
  });
});
