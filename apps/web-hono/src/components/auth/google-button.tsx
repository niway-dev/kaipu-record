import { useState } from "react";
import { Button } from "@kaipu/web-ui";
import { useTranslations } from "@kaipu/i18n";
import { SignupLegalNotice } from "@/components/legal/signup-legal-notice";
import { authClient } from "@/lib/auth/auth-client";
import { desktopAuthSearch, desktopDonePath, type DesktopAuthQuery } from "@/lib/desktop-auth";
import { googleStartErrorKey } from "@/lib/google-auth";
import { resolvePostSignInPath } from "@/lib/post-sign-in";

/** Google's multicolour "G", per its sign-in branding guidelines (not recoloured, not cropped). */
export function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export interface GoogleButtonProps {
  mode: "sign-in" | "sign-up";
  /** The same `redirect` the email form honours; validated again by resolvePostSignInPath. */
  redirectTo?: string;
  /**
   * Desktop sign-in (NIW2-471): the app's query goes with the request, so the electron plugin keeps
   * it across the Google round trip and mints the code on the callback, and both outcomes return
   * to the desktop pages instead of the dashboard or /auth/login.
   */
  desktop?: DesktopAuthQuery;
}

/**
 * "Continue with Google" plus the "or" divider, above the email form on /auth/login and
 * /auth/signup and /auth/desktop. Always shown; a server without Google answers with an error that
 * is shown as a friendly message.
 */
export function GoogleButton({ mode, redirectTo, desktop }: GoogleButtonProps) {
  const t = useTranslations("auth");
  const [redirecting, setRedirecting] = useState(false);
  const [errorKey, setErrorKey] = useState<ReturnType<typeof googleStartErrorKey> | null>(null);

  async function start() {
    setRedirecting(true);
    setErrorKey(null);
    const destination = desktop
      ? desktopDonePath(desktop)
      : resolvePostSignInPath({ redirect: redirectTo });
    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: destination,
      newUserCallbackURL: destination,
      // Better Auth appends `?error=<code>` (`&error=` after the desktop query); both pages map it
      // to copy.
      errorCallbackURL: desktop ? `/auth/desktop${desktopAuthSearch(desktop)}` : "/auth/login",
      fetchOptions: desktop ? { query: { ...desktop } } : undefined,
    });
    // On success the browser is already navigating to Google; only a failure comes back here.
    if (result?.error) {
      setRedirecting(false);
      setErrorKey(googleStartErrorKey(result.error));
    }
  }

  return (
    <div className="mb-6 space-y-4">
      <Button
        type="button"
        variant="outline"
        className="w-full gap-2"
        disabled={redirecting}
        onClick={() => void start()}
      >
        <GoogleMark />
        {redirecting ? t("googleRedirecting") : t("continueWithGoogle")}
      </Button>
      {errorKey && (
        <p role="alert" className="text-destructive text-sm">
          {t(errorKey)}
        </p>
      )}
      {mode === "sign-up" && <SignupLegalNotice messageKey="googleSignupNotice" />}
      <div className="flex items-center gap-3 text-xs text-muted-foreground uppercase">
        <span className="h-px flex-1 bg-border" />
        {t("orDivider")}
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
