import { PairDevice } from "@/components/pair-device";

export const dynamic = "force-dynamic";

export default function ConnectionsPage() {
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
          <a className="btn-outline self-start" href="/api/google/calendar/connect">
            connect google calendar
          </a>
        </section>
      </div>
    </div>
  );
}
