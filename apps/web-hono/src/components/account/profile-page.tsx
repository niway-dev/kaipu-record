import { TriangleAlert } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { oauthErrorKey } from "@/lib/google-auth";
import { Notice, PageHeading, PageStack } from "@/components/dashboard/ui";
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
  const tAuth = useTranslations("auth");
  return (
    <PageStack>
      <PageHeading title={t("profileTitle")} description={t("profileDescription")} />
      {oauthError ? (
        <Notice
          tone="danger"
          role="alert"
          icon={<TriangleAlert size={18} />}
          title={tAuth(oauthErrorKey(oauthError))}
        />
      ) : null}
      <ProfileSection user={user} onSessionChanged={onSessionChanged} />
      <SignInMethodsSection googleControls={<GoogleSignInControls />} />
    </PageStack>
  );
}
