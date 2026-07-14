import { DemoNote } from "@/components/demo-note";
import { PreferencesPanel } from "@/components/preferences-view";
import { loadPreferences } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
  const { data, demo } = await loadPreferences();
  return (
    <div>
      <h1 className="display text-3xl text-ink">preferences</h1>
      <p className="mb-8 mt-2 text-sm text-mute">
        how soon behaves — quiet by default, always yours to change.
      </p>
      <DemoNote show={demo} />
      <PreferencesPanel prefs={data} />
    </div>
  );
}
