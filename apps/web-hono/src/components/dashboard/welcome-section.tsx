import { useEffect, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { useAccountStorage } from "@/hooks/use-account-storage";
import { hasSeenWelcome, markWelcomeSeen } from "@/lib/first-visit";
import { Notice } from "@/components/account/notice";
import { VerificationNotice } from "@/components/account/verification-notice";
import type { AccountUser } from "@/components/account/profile-section";

/** What to call the user: their name, or the part of the email before the `@`. */
export function displayName(user: Pick<AccountUser, "name" | "email">): string {
  const name = user.name.trim();
  if (name) return name;
  return user.email.split("@")[0] || user.email;
}

export function WelcomeSection({
  user,
  onSessionChanged,
}: {
  user: AccountUser;
  /** Re-reads everything that came from the session (header, badge, storage). */
  onSessionChanged: () => Promise<void>;
}) {
  const t = useTranslations("dashboard");
  const ts = useTranslations("storageCloud");
  const { plan } = useAccountStorage();

  // Decided after mount: the server render has no localStorage, so reading it during render would
  // make the first client render disagree with the markup. Marking it seen on the same visit means
  // the welcome shows once per browser, however the visit ends.
  const [firstVisit, setFirstVisit] = useState(false);
  useEffect(() => {
    if (hasSeenWelcome(user.id)) return;
    markWelcomeSeen(user.id);
    setFirstVisit(true);
  }, [user.id]);

  const planName = plan ? (plan.plan === "pro" ? ts("planPro") : ts("planFree")) : null;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">{t("greeting", { name: displayName(user) })}</h1>
        <p className="text-muted-foreground mt-1">{t("signedInAs", { email: user.email })}</p>
      </div>
      {firstVisit && (
        <Notice
          title={t("firstVisitTitle")}
          detail={planName ? t("firstVisitPlan", { plan: planName }) : t("firstVisitNoPlan")}
        />
      )}
      <VerificationNotice user={user} onSessionChanged={onSessionChanged} />
    </section>
  );
}
