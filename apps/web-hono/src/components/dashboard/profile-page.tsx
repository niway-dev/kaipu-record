import { useTranslations } from "@kaipu/i18n";
import { ProfileSection, type AccountUser } from "@/components/account/profile-section";
import { SignInMethodsSection } from "@/components/account/sign-in-methods-section";

/** `/dashboard/profile`: who you are and how you sign in. Pure composition. */
export function ProfilePage({
  user,
  onSessionChanged,
}: {
  user: AccountUser;
  onSessionChanged: () => Promise<void>;
}) {
  const t = useTranslations("dashboard");
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <div>
        <h1 className="text-3xl font-bold">{t("profileTitle")}</h1>
        <p className="text-muted-foreground mt-1">{t("profileDescription")}</p>
      </div>
      <ProfileSection user={user} onSessionChanged={onSessionChanged} />
      <SignInMethodsSection />
    </div>
  );
}
