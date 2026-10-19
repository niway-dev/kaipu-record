import { useTranslations } from "@kaipu/i18n";
import type { AccountUser } from "@/components/account/profile-section";
import { VerificationNotice } from "@/components/account/verification-notice";

/** The name to greet: the profile name, or the part of the email before `@` when it is empty. */
export function greetingName(user: Pick<AccountUser, "name" | "email">): string {
  const name = user.name.trim();
  if (name) return name;
  return user.email.split("@")[0] ?? user.email;
}

export function WelcomeSection({
  user,
  onSessionChanged,
}: {
  user: AccountUser;
  onSessionChanged: () => Promise<void>;
}) {
  const t = useTranslations("dashboard");
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">{t("welcomeTitle", { name: greetingName(user) })}</h1>
        <p className="text-muted-foreground mt-1">
          {t("welcomeSignedInAs", { email: user.email })}
        </p>
      </div>
      {!user.emailVerified && (
        <VerificationNotice user={user} onSessionChanged={onSessionChanged} />
      )}
    </section>
  );
}
