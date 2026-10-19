import { useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";
import { Button } from "@kaipu/web-ui";

import { OAuthErrorAlert } from "@/components/oauth-error-alert";
import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { authClient } from "@/lib/auth/auth-client";
import { desktopAuthClient } from "@/lib/auth/desktop-auth-client";
import type { AuthSession } from "@/lib/auth/types";
import { desktopDonePath, type DesktopAuthIntent, type DesktopAuthQuery } from "@/lib/desktop-auth";

/**
 * `/auth/desktop` (NIW2-471). The desktop app opens it in the system browser with its
 * `client_id`, `state` and `code_challenge`:
 *
 * - without them it explains that sign-in starts in the app;
 * - a signed-in visitor confirms the account ("Continue") or switches to another one;
 * - anyone else gets the regular sign-in form — or the sign-up form when the app's "Create
 *   account" opened the page with `intent=sign-up` — which carries the query to the API;
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
      <Card>
        <h1 className="mb-4 text-center text-2xl font-bold">{t("invalidTitle")}</h1>
        <p className="text-center text-sm text-muted-foreground">{t("invalidBody")}</p>
      </Card>
    );
  }

  if (session) return <ConfirmAccount query={query} session={session} />;
  return <SignInForDesktop query={query} intent={intent} oauthError={oauthError} />;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full mt-10 max-w-md p-6">{children}</div>;
}

function ConfirmAccount({ query, session }: { query: DesktopAuthQuery; session: AuthSession }) {
  const t = useTranslations("desktopAuth");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const account = session.user.name
    ? `${session.user.name} (${session.user.email})`
    : session.user.email;

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
    <Card>
      <h1 className="mb-4 text-center text-2xl font-bold">{t("confirmTitle")}</h1>
      <p className="mb-6 text-center text-sm text-muted-foreground">
        {t("confirmBody", { account })}
      </p>
      <div className="space-y-3">
        <Button className="w-full" disabled={pending} onClick={() => void continueAsCurrentUser()}>
          {pending ? t("continuing") : t("continue")}
        </Button>
        <Button
          variant="outline"
          className="w-full"
          disabled={pending}
          onClick={() => void switchAccount()}
        >
          {t("switchAccount")}
        </Button>
      </div>
      {failed ? (
        <p role="alert" className="mt-4 text-center text-sm text-red-500">
          {t("transferFailed")}
        </p>
      ) : null}
    </Card>
  );
}

function SignInForDesktop({
  query,
  intent,
  oauthError,
}: {
  query: DesktopAuthQuery;
  intent?: DesktopAuthIntent;
  oauthError?: string;
}) {
  const t = useTranslations("desktopAuth");
  const tAuth = useTranslations("auth");
  return (
    <Card>
      <p className="mb-2 text-center text-sm font-medium">{t("signInTitle")}</p>
      <p className="mb-4 text-center text-sm text-muted-foreground">{t("signInBody")}</p>
      <OAuthErrorAlert code={oauthError} />
      {intent === "sign-up" ? (
        <>
          <SignUpForm desktop={query} />
          <div className="mt-4 text-center text-sm text-muted-foreground">
            {tAuth("haveAccount")}{" "}
            <Link to="/auth/desktop" search={{ ...query }} className="text-primary hover:underline">
              {tAuth("signIn")}
            </Link>
          </div>
        </>
      ) : (
        <>
          <SignInForm desktop={query} />
          <div className="mt-4 text-center text-sm text-muted-foreground">
            {tAuth("needAccount")}{" "}
            <Link
              to="/auth/desktop"
              search={{ ...query, intent: "sign-up" }}
              className="text-primary hover:underline"
            >
              {tAuth("signUp")}
            </Link>
          </div>
          <div className="mt-2 text-center text-sm text-muted-foreground">
            <Link to="/auth/forgot-password" className="text-primary hover:underline">
              {tAuth("forgotPassword")}
            </Link>
          </div>
        </>
      )}
    </Card>
  );
}
