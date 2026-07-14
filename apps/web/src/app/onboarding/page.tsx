import { OnboardingWizard } from "@/components/onboarding-wizard";

export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  return (
    <div className="pt-6">
      <OnboardingWizard />
    </div>
  );
}
