import { describe, expect, it } from "vitest";
import { FakeCalendarApi } from "./fake-calendar-api.js";
import { getBusyIntervals, getBusyIntervalsFromEvents, mergeIntervals } from "./free-busy.js";
import { FreeBusyLookupError } from "./errors.js";

const T = (iso: string): number => Date.parse(iso);

const WINDOW = {
  timeMin: "2026-07-20T00:00:00.000Z",
  timeMax: "2026-07-21T00:00:00.000Z",
};

function timedEvent(startIso: string, endIso: string, extra: object = {}) {
  return { start: { dateTime: startIso }, end: { dateTime: endIso }, ...extra };
}

describe("mergeIntervals", () => {
  it("returns empty for no input and drops zero-length intervals", () => {
    expect(mergeIntervals([])).toEqual([]);
    expect(mergeIntervals([{ start: 100, end: 100 }])).toEqual([]);
  });

  it("merges overlapping and touching intervals, keeps disjoint ones", () => {
    expect(
      mergeIntervals([
        { start: 300, end: 400 },
        { start: 0, end: 100 },
        { start: 50, end: 150 },
        { start: 150, end: 200 },
      ]),
    ).toEqual([
      { start: 0, end: 200 },
      { start: 300, end: 400 },
    ]);
  });
});

describe("getBusyIntervals (freebusy)", () => {
  it("merges busy blocks across calendars into epoch-ms intervals", async () => {
    const api = new FakeCalendarApi();
    api.seedEvent("work", timedEvent("2026-07-20T10:00:00.000Z", "2026-07-20T11:00:00.000Z"));
    api.seedEvent("personal", timedEvent("2026-07-20T10:30:00.000Z", "2026-07-20T12:00:00.000Z"));
    api.seedEvent("work", timedEvent("2026-07-20T15:00:00.000Z", "2026-07-20T16:00:00.000Z"));

    const busy = await getBusyIntervals(api, { calendarIds: ["work", "personal"], ...WINDOW });
    expect(busy).toEqual([
      { start: T("2026-07-20T10:00:00.000Z"), end: T("2026-07-20T12:00:00.000Z") },
      { start: T("2026-07-20T15:00:00.000Z"), end: T("2026-07-20T16:00:00.000Z") },
    ]);
  });

  it("returns empty for no calendars", async () => {
    const api = new FakeCalendarApi();
    expect(await getBusyIntervals(api, { calendarIds: [], ...WINDOW })).toEqual([]);
  });

  it("counts tentative events as busy — the freebusy api cannot filter them", async () => {
    const api = new FakeCalendarApi();
    api.seedEvent(
      "work",
      timedEvent("2026-07-20T09:00:00.000Z", "2026-07-20T09:30:00.000Z", { status: "tentative" }),
    );
    const busy = await getBusyIntervals(api, { calendarIds: ["work"], ...WINDOW });
    expect(busy).toHaveLength(1);
  });

  it("throws FreeBusyLookupError when a calendar errors instead of assuming free", async () => {
    const api = new FakeCalendarApi();
    api.freeBusyErrors["broken"] = "notFound";
    await expect(
      getBusyIntervals(api, { calendarIds: ["broken"], ...WINDOW }),
    ).rejects.toBeInstanceOf(FreeBusyLookupError);
  });
});

describe("getBusyIntervalsFromEvents", () => {
  it("excludes tentative events when tentativeBlocks is false", async () => {
    const api = new FakeCalendarApi();
    api.seedEvent(
      "work",
      timedEvent("2026-07-20T09:00:00.000Z", "2026-07-20T10:00:00.000Z", { status: "tentative" }),
    );
    api.seedEvent("work", timedEvent("2026-07-20T13:00:00.000Z", "2026-07-20T14:00:00.000Z"));

    const busy = await getBusyIntervalsFromEvents(api, {
      calendarIds: ["work"],
      ...WINDOW,
      tentativeBlocks: false,
    });
    expect(busy).toEqual([
      { start: T("2026-07-20T13:00:00.000Z"), end: T("2026-07-20T14:00:00.000Z") },
    ]);
  });

  it("includes tentative events when tentativeBlocks is true", async () => {
    const api = new FakeCalendarApi();
    api.seedEvent(
      "work",
      timedEvent("2026-07-20T09:00:00.000Z", "2026-07-20T10:00:00.000Z", { status: "tentative" }),
    );
    const busy = await getBusyIntervalsFromEvents(api, {
      calendarIds: ["work"],
      ...WINDOW,
      tentativeBlocks: true,
    });
    expect(busy).toEqual([
      { start: T("2026-07-20T09:00:00.000Z"), end: T("2026-07-20T10:00:00.000Z") },
    ]);
  });

  it("skips transparent (marked free) events", async () => {
    const api = new FakeCalendarApi();
    api.seedEvent(
      "work",
      timedEvent("2026-07-20T09:00:00.000Z", "2026-07-20T17:00:00.000Z", {
        transparency: "transparent",
      }),
    );
    const busy = await getBusyIntervalsFromEvents(api, {
      calendarIds: ["work"],
      ...WINDOW,
      tentativeBlocks: true,
    });
    expect(busy).toEqual([]);
  });

  it("clips events to the query window and merges across calendars", async () => {
    const api = new FakeCalendarApi();
    // spans past the window end
    api.seedEvent("work", timedEvent("2026-07-20T23:00:00.000Z", "2026-07-21T02:00:00.000Z"));
    api.seedEvent("personal", timedEvent("2026-07-20T22:00:00.000Z", "2026-07-20T23:30:00.000Z"));

    const busy = await getBusyIntervalsFromEvents(api, {
      calendarIds: ["work", "personal"],
      ...WINDOW,
      tentativeBlocks: true,
    });
    expect(busy).toEqual([
      { start: T("2026-07-20T22:00:00.000Z"), end: T("2026-07-21T00:00:00.000Z") },
    ]);
  });
});
