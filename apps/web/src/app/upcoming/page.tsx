import { DemoNote } from "@/components/demo-note";
import { UpcomingList } from "@/components/upcoming-list";
import { loadUpcoming } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function UpcomingPage() {
  const { data, demo } = await loadUpcoming();
  return (
    <div>
      <h1 className="display text-3xl text-ink">upcoming conversations</h1>
      <p className="mb-8 mt-2 text-sm text-mute">
        everything soon is working on, in the order it needs attention.
      </p>
      <DemoNote show={demo} />
      <UpcomingList sessions={data} />
    </div>
  );
}
