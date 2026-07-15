"use client";

import type { ScheduledEventView } from "@/lib/types";
import { MEETING_FORMAT_LABELS } from "@/lib/copy";
import { formatDayTime, initialOf } from "@/lib/format";
import { useAction } from "@/lib/use-action";

/**
 * a google calendar url that reliably opens the day the meeting is on (in the
 * event's timezone) — where the soon-created event appears. deep-linking to a
 * specific event needs google's opaque `eid`, which we don't persist; the day
 * view is stable and always resolves.
 */
function googleCalendarDayUrl(startsAtIso: string | null, timezone: string): string {
  if (startsAtIso === null) return "https://calendar.google.com/calendar/u/0/r";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(startsAtIso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return `https://calendar.google.com/calendar/u/0/r/day/${get("year")}/${get("month")}/${get("day")}`;
}

export function ScheduledList({ events }: { events: ScheduledEventView[] }) {
  if (events.length === 0) {
    return (
      <div className="inset-group px-8 py-16 text-center">
        <p className="text-base text-charcoal">nothing scheduled by soon yet.</p>
        <p className="mt-1 text-sm text-mute">
          once a time is agreed, the event lands here and on your calendar.
        </p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {events.map((event) => (
        <EventRow key={event.sessionId} event={event} />
      ))}
    </ul>
  );
}

function EventRow({ event }: { event: ScheduledEventView }) {
  const { run, pending, message } = useAction();
  const act = (body: Record<string, unknown>, label: string) =>
    run(`/api/sessions/${event.sessionId}/actions`, body, label);

  return (
    <li className="card flex flex-wrap items-center gap-4 p-4">
      <div
        aria-hidden
        className="display flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bone text-lg text-ink"
      >
        {initialOf(event.attendeeName)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-base font-semibold text-ink">{event.title}</span>
          {event.status === "confirmed" ? (
            <span className="badge-success">confirmed</span>
          ) : (
            <span className="pill">invite pending</span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-charcoal">
          with {event.attendeeName}
          {event.startsAtIso && ` · ${formatDayTime(event.startsAtIso, event.timezone)}`}
          {MEETING_FORMAT_LABELS[event.meetingFormat] &&
            ` · ${MEETING_FORMAT_LABELS[event.meetingFormat]}`}
          {event.location && ` · ${event.location}`}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-ash">
          calendar: {event.calendarName}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(event.startsAtIso || event.calendarEventId) && (
          <a
            className="btn-outline btn-sm"
            href={googleCalendarDayUrl(event.startsAtIso, event.timezone)}
            target="_blank"
            rel="noreferrer"
          >
            open in google calendar
          </a>
        )}
        <button
          type="button"
          className="btn-ghost btn-sm"
          disabled={pending !== null}
          onClick={() => act({ action: "take_over" }, "reschedule")}
        >
          reschedule
        </button>
        <button
          type="button"
          className="btn-ghost btn-sm text-mute"
          disabled={pending !== null}
          onClick={() => act({ action: "cancel", reason: "cancelled from dashboard" }, "cancel")}
        >
          {pending === "cancel" ? "cancelling…" : "cancel"}
        </button>
      </div>
      {message && <p className="w-full text-xs text-charcoal">{message}</p>}
    </li>
  );
}
