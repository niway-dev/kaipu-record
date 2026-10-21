import { useTranslations } from "@kaipu/i18n";
import type { AccountUser } from "@/components/account/profile-section";
import { VerificationNotice } from "@/components/account/verification-notice";
import { PageHeading } from "./ui";

/** The name to greet: the profile name, or the part of the email before `@` when it is empty. */
export function greetingName(user: Pick<AccountUser, "name" | "email">): string {
  const name = user.name.trim();
  if (name) return name;
  return user.email.split("@")[0] ?? user.email;
}

/** "Hi, Ana" + "Good to see you." and who is signed in; the verification notice when needed. */
export function WelcomeSection({
  user,
  onSessionChanged,
}: {
  user: AccountUser;
  onSessionChanged: () => Promise<void>;
}) {
  const t = useTranslations("dashboard");
  return (
    <>
      <PageHeading
        title={t("welcomeTitle", { name: greetingName(user) })}
        serif={t("welcomeSerif")}
        description={t("welcomeSignedInAs", { email: user.email })}
      />
      {!user.emailVerified && (
        <VerificationNotice user={user} onSessionChanged={onSessionChanged} />
      )}
    </>
  );
}
