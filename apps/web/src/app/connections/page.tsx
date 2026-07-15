import { PairDevice } from "@/components/pair-device";
import { loadCalendarConnection } from "@/lib/data";

export const dynamic = "force-dynamic";

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink" fill="none" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16" rx="3" fill="var(--color-card)" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 8.5h18" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 2.5v3M16 2.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="10" y="12" width="4" height="4" rx="0.5" fill="var(--color-primary)" />
    </svg>
  );
}

export default async function ConnectionsPage() {
  const calendar = await loadCalendarConnection();

  return (
    <div>
      <h1 className="display text-3xl text-ink">connections</h1>
      <p className="mb-8 mt-2 text-sm text-mute">
        the pieces soon needs to work: your mac and your calendar.
      </p>

      <div className="flex flex-col gap-6">
        <section className="card-lg p-6">
          <h2 className="display text-lg text-ink">your mac</h2>
          <p className="mb-5 mt-1 text-sm text-mute">
            the mac companion is the only thing that reads and sends imessage. pair it once —
            it stays connected and keeps its own credentials.
          </p>
          <PairDevice />
        </section>

        <section className="card-lg p-6">
          <h2 className="display text-lg text-ink">google calendar</h2>
          <p className="mb-5 mt-1 text-sm text-mute">
            soon checks when you&apos;re free and creates invites after a time is confirmed. it
            requests the minimum scopes — free/busy, event read, and events it creates.
          </p>

          {calendar.connected ? (
            <div className="inset-group flex items-center gap-3 p-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-hairline bg-card">
                <CalendarGlyph />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">google calendar connected</p>
                {calendar.email !== null && (
                  <p className="truncate text-xs text-mute">{calendar.email}</p>
                )}
              </div>
              <span className="badge-success ml-auto shrink-0">connected</span>
              <a className="btn-ghost btn-sm shrink-0" href="/api/google/calendar/connect">
                reconnect
              </a>
            </div>
          ) : (
            <a className="btn-outline self-start" href="/api/google/calendar/connect">
              connect google calendar
            </a>
          )}
        </section>
      </div>
    </div>
  );
}
