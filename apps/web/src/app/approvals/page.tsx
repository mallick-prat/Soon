import { ApprovalList } from "@/components/approval-list";
import { DemoNote } from "@/components/demo-note";
import { loadApprovals } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const { data, demo } = await loadApprovals();
  return (
    <div>
      <h1 className="display text-3xl text-ink">approvals</h1>
      <p className="mb-8 mt-2 text-sm text-mute">
        messages soon wants to send. nothing goes out without you.
      </p>
      <DemoNote show={demo} />
      <ApprovalList drafts={data} />
    </div>
  );
}
