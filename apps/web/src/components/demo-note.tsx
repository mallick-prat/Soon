export function DemoNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-hairline bg-bone px-3 py-1 text-xs text-mute">
      showing demo data — connect a database to see your real conversations
    </p>
  );
}
