import type { AccountUser } from "@/components/account/profile-section";
import { FirstVisitWelcome } from "./first-visit-welcome";
import { GetStarted } from "./get-started";
import { StorageSummary } from "./storage-summary";
import { WelcomeSection } from "./welcome-section";

/** `/dashboard`: who you are, your plan and space, and how to start recording. */
export function DashboardHome({
  user,
  onSessionChanged,
}: {
  user: AccountUser;
  onSessionChanged: () => Promise<void>;
}) {
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
      <FirstVisitWelcome userId={user.id} />
      <WelcomeSection user={user} onSessionChanged={onSessionChanged} />
      <StorageSummary />
      <GetStarted />
    </div>
  );
}
