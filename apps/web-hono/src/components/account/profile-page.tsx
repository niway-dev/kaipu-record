import { useTranslations } from "@kaipu/i18n";
import { OAuthErrorAlert } from "@/components/oauth-error-alert";
import { GoogleSignInControls } from "./google-sign-in-controls";
import { ProfileSection, type AccountUser } from "./profile-section";
import { SignInMethodsSection } from "./sign-in-methods-section";

export interface ProfilePageProps {
  user: AccountUser;
  onSessionChanged: () => Promise<void>;
  /** `?error=` from a failed "Connect Google" round trip (Better Auth's errorCallbackURL). */
  oauthError?: string;
}

/** `/dashboard/profile`: who you are and how you sign in. Each section owns its own data. */
export function ProfilePage({ user, onSessionChanged, oauthError }: ProfilePageProps) {
  const t = useTranslations("dashboard");
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-3xl font-bold">{t("profileTitle")}</h1>
        <p className="text-muted-foreground mt-1">{t("profileDescription")}</p>
      </div>
      <OAuthErrorAlert code={oauthError} />
      <ProfileSection user={user} onSessionChanged={onSessionChanged} />
      <SignInMethodsSection googleControls={<GoogleSignInControls />} />
    </div>
  );
}
