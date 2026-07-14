import { describe, expect, it } from "vitest";
import { FakeCalendarApi } from "@soon/calendar";

import { createCalendarAvailability, type CalendarContext } from "./calendar-availability.js";

const withApi = (api: FakeCalendarApi, blocking: string[] = ["primary"]): CalendarContext => ({
  api,
  blockingCalendarIds: blocking,
  destinationCalendarId: "primary",
  tentativeBlocks: true,
});

const seedBusy = (api: FakeCalendarApi) =>
  api.seedEvent("primary", {
    summary: "standup",
    start: { dateTime: "2026-07-21T19:00:00.000Z" },
    end: { dateTime: "2026-07-21T19:30:00.000Z" },
  });

describe("createCalendarAvailability", () => {
  it("returns busy intervals from the blocking calendars", async () => {
    const api = new FakeCalendarApi();
    seedBusy(api);
    const availability = createCalendarAvailability({ resolveContext: async () => withApi(api) });

    const busy = await availability.getBusy("u1", "2026-07-21T00:00:00.000Z", "2026-07-22T00:00:00.000Z");
    expect(busy).toEqual([
      { start: Date.parse("2026-07-21T19:00:00.000Z"), end: Date.parse("2026-07-21T19:30:00.000Z") },
    ]);
  });

  it("slotStillFree is false when the slot overlaps a busy event, true when clear", async () => {
    const api = new FakeCalendarApi();
    seedBusy(api);
    const availability = createCalendarAvailability({ resolveContext: async () => withApi(api) });

    const overlapping = { start: Date.parse("2026-07-21T19:15:00.000Z"), end: Date.parse("2026-07-21T19:45:00.000Z") };
    const clear = { start: Date.parse("2026-07-21T21:00:00.000Z"), end: Date.parse("2026-07-21T21:30:00.000Z") };
    expect(await availability.slotStillFree("u1", overlapping)).toBe(false);
    expect(await availability.slotStillFree("u1", clear)).toBe(true);
  });

  it("creates an event on the destination calendar and returns id + link", async () => {
    const api = new FakeCalendarApi();
    const availability = createCalendarAvailability({ resolveContext: async () => withApi(api) });

    const result = await availability.createEvent({
      userId: "u1",
      sessionId: "s1",
      conversationId: "c1",
      idempotencyKey: "idem-1",
      startIso: "2026-07-21T19:00:00.000Z",
      endIso: "2026-07-21T19:30:00.000Z",
      timezone: "America/New_York",
      attendeeEmail: "alex@example.com",
      title: "catch up with alex",
      wantsMeet: true,
    });

    expect(result.eventId).toMatch(/^evt_/);
    expect(result.htmlLink).toContain("calendar.example");
    expect(api.inserts).toHaveLength(1);
    expect(api.inserts[0]!.calendarId).toBe("primary");
  });

  it("treats a user with no blocking calendars as fully free", async () => {
    const api = new FakeCalendarApi();
    seedBusy(api);
    const availability = createCalendarAvailability({ resolveContext: async () => withApi(api, []) });
    expect(await availability.getBusy("u1", "2026-07-21T00:00:00.000Z", "2026-07-22T00:00:00.000Z")).toEqual([]);
    expect(
      await availability.slotStillFree("u1", {
        start: Date.parse("2026-07-21T19:15:00.000Z"),
        end: Date.parse("2026-07-21T19:45:00.000Z"),
      }),
    ).toBe(true);
  });
});
