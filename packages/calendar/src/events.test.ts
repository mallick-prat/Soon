import { describe, expect, it } from "vitest";
import { FakeCalendarApi } from "./fake-calendar-api.js";
import {
  cancelEvent,
  createEvent,
  defaultEventTitle,
  findEventByIdempotencyKey,
  findEventBySession,
  updateEvent,
} from "./events.js";
import { NotSoonEventError } from "./errors.js";
import type { CreateEventInput } from "./events.js";

const BASE_INPUT: CreateEventInput = {
  calendarId: "primary",
  startIso: "2026-07-22T15:00:00.000Z",
  endIso: "2026-07-22T15:30:00.000Z",
  timezone: "America/New_York",
  attendeeEmail: "sam@example.com",
  title: "catch up with sam",
  wantsMeet: true,
  sessionId: "sess_1",
  conversationId: "conv_1",
  idempotencyKey: "idem_1",
};

describe("defaultEventTitle", () => {
  it("builds the default and sensitive-context titles, lowercased", () => {
    expect(defaultEventTitle("Sam")).toBe("catch up with sam");
    expect(defaultEventTitle("Sam", { sensitive: true })).toBe("meeting with sam");
    expect(defaultEventTitle("  ")).toBe("catch up");
  });
});

describe("createEvent", () => {
  it("inserts with attendee invitation, blank description default, and private soon tags only", async () => {
    const api = new FakeCalendarApi();
    const { event, deduplicated } = await createEvent(api, BASE_INPUT);

    expect(deduplicated).toBe(false);
    expect(event.summary).toBe("catch up with sam");
    expect(event.sessionId).toBe("sess_1");
    expect(event.conversationId).toBe("conv_1");
    expect(event.idempotencyKey).toBe("idem_1");

    const insert = api.inserts[0];
    expect(api.inserts).toHaveLength(1);
    expect(insert?.sendUpdates).toBe("all");
    expect(insert?.requestBody.attendees).toEqual([{ email: "sam@example.com" }]);
    expect(insert?.requestBody.description).toBe("");
    expect(insert?.requestBody.extendedProperties?.private).toEqual({
      soonSessionId: "sess_1",
      soonConversationId: "conv_1",
      soonIdempotencyKey: "idem_1",
    });
    // system identifiers must never leak into attendee-visible fields
    for (const visible of [
      insert?.requestBody.summary,
      insert?.requestBody.description,
      insert?.requestBody.location,
    ]) {
      expect(visible ?? "").not.toMatch(/sess_1|conv_1|idem_1|soon/);
    }
  });

  it("is idempotent: a second create with the same key returns the same event without inserting", async () => {
    const api = new FakeCalendarApi();
    const first = await createEvent(api, BASE_INPUT);
    const second = await createEvent(api, BASE_INPUT);

    expect(second.deduplicated).toBe(true);
    expect(second.event.eventId).toBe(first.event.eventId);
    expect(api.inserts).toHaveLength(1);
  });

  it("requests a meet link with conferenceDataVersion 1 when wantsMeet", async () => {
    const api = new FakeCalendarApi();
    const { event } = await createEvent(api, BASE_INPUT);

    const insert = api.inserts[0];
    expect(insert?.conferenceDataVersion).toBe(1);
    expect(insert?.requestBody.conferenceData?.createRequest?.requestId).toBe("idem_1");
    expect(event.meetLink).toMatch(/^https:\/\/meet\.google\.com\//);
  });

  it("creates no conference for a phone call (wantsMeet false)", async () => {
    const api = new FakeCalendarApi();
    const { event } = await createEvent(api, { ...BASE_INPUT, wantsMeet: false });

    const insert = api.inserts[0];
    expect(insert?.conferenceDataVersion).toBeUndefined();
    expect(insert?.requestBody.conferenceData).toBeUndefined();
    expect(event.meetLink).toBeUndefined();
  });

  it("uses the provided location text for in-person and never invents one", async () => {
    const api = new FakeCalendarApi();
    const inPerson = await createEvent(api, {
      ...BASE_INPUT,
      wantsMeet: false,
      location: "tatte back bay",
      idempotencyKey: "idem_loc",
    });
    expect(inPerson.event.location).toBe("tatte back bay");

    await createEvent(api, { ...BASE_INPUT, wantsMeet: false, idempotencyKey: "idem_noloc" });
    expect(api.inserts[1]?.requestBody.location).toBeUndefined();
  });
});

describe("reconciliation lookups", () => {
  it("findEventBySession and findEventByIdempotencyKey return the live event", async () => {
    const api = new FakeCalendarApi();
    const { event } = await createEvent(api, BASE_INPUT);

    const bySession = await findEventBySession(api, { calendarId: "primary", sessionId: "sess_1" });
    const byKey = await findEventByIdempotencyKey(api, {
      calendarId: "primary",
      idempotencyKey: "idem_1",
    });
    expect(bySession?.eventId).toBe(event.eventId);
    expect(byKey?.eventId).toBe(event.eventId);
  });

  it("returns null when nothing matches or the match was cancelled", async () => {
    const api = new FakeCalendarApi();
    expect(await findEventBySession(api, { calendarId: "primary", sessionId: "nope" })).toBeNull();

    const { event } = await createEvent(api, BASE_INPUT);
    await cancelEvent(api, { calendarId: "primary", eventId: event.eventId, sessionId: "sess_1" });
    expect(
      await findEventByIdempotencyKey(api, { calendarId: "primary", idempotencyKey: "idem_1" }),
    ).toBeNull();
  });
});

describe("updateEvent", () => {
  it("patches start/end and notifies the attendee", async () => {
    const api = new FakeCalendarApi();
    const { event } = await createEvent(api, BASE_INPUT);

    const updated = await updateEvent(api, {
      calendarId: "primary",
      eventId: event.eventId,
      sessionId: "sess_1",
      startIso: "2026-07-23T16:00:00.000Z",
      endIso: "2026-07-23T16:30:00.000Z",
      timezone: "America/New_York",
    });

    expect(updated.start).toBe("2026-07-23T16:00:00.000Z");
    expect(updated.end).toBe("2026-07-23T16:30:00.000Z");
    expect(api.patches[0]?.sendUpdates).toBe("all");
    // reschedule must not touch attendee-visible content
    expect(api.patches[0]?.requestBody.summary).toBeUndefined();
  });

  it("throws NotSoonEventError for an event soon did not create", async () => {
    const api = new FakeCalendarApi();
    const foreign = api.seedEvent("primary", {
      summary: "dentist",
      start: { dateTime: "2026-07-23T16:00:00.000Z" },
      end: { dateTime: "2026-07-23T17:00:00.000Z" },
    });

    await expect(
      updateEvent(api, {
        calendarId: "primary",
        eventId: foreign.id ?? "",
        sessionId: "sess_1",
        startIso: "2026-07-24T16:00:00.000Z",
        endIso: "2026-07-24T16:30:00.000Z",
        timezone: "America/New_York",
      }),
    ).rejects.toBeInstanceOf(NotSoonEventError);
    expect(api.patches).toHaveLength(0);
  });

  it("throws NotSoonEventError when the event belongs to a different session", async () => {
    const api = new FakeCalendarApi();
    const { event } = await createEvent(api, BASE_INPUT);

    await expect(
      updateEvent(api, {
        calendarId: "primary",
        eventId: event.eventId,
        sessionId: "someone_elses_session",
        startIso: "2026-07-24T16:00:00.000Z",
        endIso: "2026-07-24T16:30:00.000Z",
        timezone: "America/New_York",
      }),
    ).rejects.toBeInstanceOf(NotSoonEventError);
  });
});

describe("cancelEvent", () => {
  it("deletes a soon-created event and notifies the attendee", async () => {
    const api = new FakeCalendarApi();
    const { event } = await createEvent(api, BASE_INPUT);

    await cancelEvent(api, { calendarId: "primary", eventId: event.eventId, sessionId: "sess_1" });

    expect(api.deletes).toEqual([
      { calendarId: "primary", eventId: event.eventId, sendUpdates: "all" },
    ]);
  });

  it("refuses to cancel an event soon did not create", async () => {
    const api = new FakeCalendarApi();
    const foreign = api.seedEvent("primary", { summary: "dentist" });

    await expect(
      cancelEvent(api, { calendarId: "primary", eventId: foreign.id ?? "", sessionId: "sess_1" }),
    ).rejects.toBeInstanceOf(NotSoonEventError);
    expect(api.deletes).toHaveLength(0);
  });
});
