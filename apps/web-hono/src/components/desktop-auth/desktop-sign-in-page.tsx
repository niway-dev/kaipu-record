import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";

import { AuthPanel } from "@/components/auth/auth-panel";
import {
  AccountChip,
  DesktopWaitingBanner,
  ErrorBanner,
  GhostButton,
  HeroBody,
  HeroHeader,
  PrimaryButton,
  Spaced,
} from "@/components/auth/auth-ui";
import { authClient } from "@/lib/auth/auth-client";
import { desktopAuthClient } from "@/lib/auth/desktop-auth-client";
import type { AuthSession } from "@/lib/auth/types";
import { desktopDonePath, type DesktopAuthIntent, type DesktopAuthQuery } from "@/lib/desktop-auth";
import { useDesktopPlatform } from "@/components/auth/use-desktop-platform";

/**
 * `/auth/desktop` (NIW2-471). The desktop app opens it in the system browser with its
 * `client_id`, `state` and `code_challenge`:
 *
 * - without them it explains that sign-in starts in the app;
 * - a signed-in visitor confirms the account ("Continue as …") or switches to another one;
 * - anyone else gets the shared sign-in page — on its "Create account" tab when the app's
 *   "Create account" opened it with `intent=sign-up` — which carries the query to the API;
 * - a failed Google round trip comes back here with `error=<code>`, shown as copy.
 *
 * Every path ends on `/auth/desktop/done`, which hands the code to the app.
 */
export function DesktopSignInPage({
  query,
  session,
  intent,
  oauthError,
}: {
  query: DesktopAuthQuery | null;
  session: AuthSession | null;
  intent?: DesktopAuthIntent;
  oauthError?: string;
}) {
  const t = useTranslations("desktopAuth");

  if (!query) {
    return (
      <HeroHeader use="product" title={t("invalidTitle")}>
        <HeroBody>{t("invalidBody")}</HeroBody>
      </HeroHeader>
    );
  }

  if (session) return <ConfirmAccount query={query} session={session} />;
  const mode = intent === "sign-up" ? "sign-up" : "sign-in";
  // Keyed by tab: both tabs are this one route, and each should start from its own Google button.
  return <AuthPanel key={mode} mode={mode} desktop={query} oauthError={oauthError} />;
}

function ConfirmAccount({ query, session }: { query: DesktopAuthQuery; session: AuthSession }) {
  const t = useTranslations("desktopAuth");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const name = session.user.name?.trim() || session.user.email;

  const platform = useDesktopPlatform();
  async function continueAsCurrentUser() {
    setPending(true);
    setFailed(false);
    // Mints a code for the signed-in user and sets the readable cookie the done page hands over.
    const { error } = await desktopAuthClient.electron
      .transferUser({ fetchOptions: { query: { ...query } } })
      .catch(() => ({ error: true }));
    if (error) {
      setPending(false);
      setFailed(true);
      return;
    }
    router.history.push(desktopDonePath(query));
  }

  async function switchAccount() {
    setPending(true);
    await authClient.signOut().catch(() => undefined);
    // Re-runs the /auth layout's session lookup; the page re-renders with the sign-in form and the
    // same URL, so the desktop query is kept.
    await router.invalidate();
    setPending(false);
  }

  return (
    <div>
      <DesktopWaitingBanner platform={platform} />
      <HeroHeader use="product" title={t("confirmTitle")}>
        <AccountChip name={session.user.name} email={session.user.email} />
        <PrimaryButton large disabled={pending} onClick={() => void continueAsCurrentUser()}>
          {pending ? t("continuing") : t("continueAs", { name })}
        </PrimaryButton>
        <Spaced>
          <GhostButton disabled={pending} onClick={() => void switchAccount()}>
            {t("switchAccount")}
          </GhostButton>
        </Spaced>
      </HeroHeader>
      {failed ? <ErrorBanner>{t("transferFailed")}</ErrorBanner> : null}
    </div>
  );
}
