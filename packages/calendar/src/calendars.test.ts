import { describe, expect, it } from "vitest";
import { FakeCalendarApi } from "./fake-calendar-api.js";
import { listCalendars } from "./calendars.js";

describe("listCalendars", () => {
  it("maps id, summary, writable (accessRole) and primary for onboarding", async () => {
    const api = new FakeCalendarApi();
    api.calendars = [
      { id: "primary@x.com", summary: "personal", accessRole: "owner", primary: true },
      { id: "team@group.calendar.google.com", summary: "team", accessRole: "writer" },
      { id: "holidays@x.com", summary: "holidays", accessRole: "reader" },
      { id: "peek@x.com", summary: "shared", accessRole: "freeBusyReader" },
    ];

    expect(await listCalendars(api)).toEqual([
      { id: "primary@x.com", summary: "personal", writable: true, primary: true },
      { id: "team@group.calendar.google.com", summary: "team", writable: true, primary: false },
      { id: "holidays@x.com", summary: "holidays", writable: false, primary: false },
      { id: "peek@x.com", summary: "shared", writable: false, primary: false },
    ]);
  });

  it("skips entries without an id and defaults missing summaries", async () => {
    const api = new FakeCalendarApi();
    api.calendars = [{ summary: "ghost" }, { id: "real@x.com", accessRole: "owner" }];
    expect(await listCalendars(api)).toEqual([
      { id: "real@x.com", summary: "", writable: true, primary: false },
    ]);
  });
});
