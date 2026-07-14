import { DemoNote } from "@/components/demo-note";
import { ScheduledList } from "@/components/scheduled-list";
import { loadScheduled } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ScheduledPage() {
  const { data, demo } = await loadScheduled();
  return (
    <div>
      <h1 className="display text-3xl text-ink">scheduled</h1>
      <p className="mb-8 mt-2 text-sm text-mute">
        meetings soon put on the calendar for you.
      </p>
      <DemoNote show={demo} />
      <ScheduledList events={data} />
    </div>
  );
}
