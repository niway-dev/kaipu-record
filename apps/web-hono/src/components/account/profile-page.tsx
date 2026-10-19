import { useTranslations } from "@kaipu/i18n";
import { ProfileSection, type AccountUser } from "./profile-section";
import { SignInMethodsSection } from "./sign-in-methods-section";

export interface ProfilePageProps {
  user: AccountUser;
  onSessionChanged: () => Promise<void>;
}

/** `/dashboard/profile`: who you are and how you sign in. Each section owns its own data. */
export function ProfilePage({ user, onSessionChanged }: ProfilePageProps) {
  const t = useTranslations("dashboard");
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-3xl font-bold">{t("profileTitle")}</h1>
        <p className="text-muted-foreground mt-1">{t("profileDescription")}</p>
      </div>
      <ProfileSection user={user} onSessionChanged={onSessionChanged} />
      <SignInMethodsSection />
    </div>
  );
}
