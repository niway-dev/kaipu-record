import { useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import type { AccountUser } from "@/components/account/profile-section";
import { CredentialDroppedNotice } from "./credential-dropped-notice";
import { FirstVisitWelcome } from "./first-visit-welcome";
import { GetStarted } from "./get-started";
import { StorageSummary } from "./storage-summary";
import { WelcomeSection } from "./welcome-section";
import { PageStack, SoonRow } from "./ui";

/**
 * `/dashboard`: who you are, your plan and space, and how to start recording.
 *
 * "Recent in your library" is drawn as Coming soon: the cloud library (NIW2-221) does not exist
 * yet, and the design never shows fake items. The web cannot see the installed desktop app, so
 * the download card is always the "unknown" state (design note "Devices and app installed").
 */
export function DashboardHome({
  user,
  onSessionChanged,
}: {
  user: AccountUser;
  onSessionChanged: () => Promise<void>;
}) {
  const t = useTranslations("dashboard");
  const [welcomeVisible, setWelcomeVisible] = useState(false);
  return (
    <PageStack>
      <WelcomeSection user={user} onSessionChanged={onSessionChanged} />
      <FirstVisitWelcome userId={user.id} onVisibleChange={setWelcomeVisible} />
      <CredentialDroppedNotice />
      <StorageSummary />
      <GetStarted withMark={!welcomeVisible} />
      <SoonRow title={t("recentTitle")} detail={t("recentBody")} tag={t("comingSoon")} />
    </PageStack>
  );
}
