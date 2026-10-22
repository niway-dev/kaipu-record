import { useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";

import { authClient } from "@/lib/auth/auth-client";
import { desktopDonePath, type DesktopAuthQuery } from "@/lib/desktop-auth";
import { resolvePostSignInPath } from "@/lib/post-sign-in";
import {
  AccentButton,
  ErrorBanner,
  linkStyles,
  PasswordField,
  PrimaryButton,
  QuietButton,
  TextField,
} from "./auth-ui";
import { isEmail, MIN_PASSWORD } from "./validation";

type Failure = "credentials" | "throttled" | "network" | "other";

/**
 * The email half of the sign-in tab, revealed by "Continue with email".
 *
 * `desktop` is set on the desktop sign-in page (NIW2-471): the request then carries the app's
 * query so the API mints an authorization code with the new session, and the visitor lands on the
 * page that hands that code to the app instead of the dashboard.
 *
 * A wrong password and an unknown email get the same answer (owner decision: no account
 * enumeration). The follow-up link reads the same either way: it offers to create an account with
 * the typed email, and says nothing about whether one exists.
 */
export default function SignInForm({
  redirectTo,
  desktop,
  defaultEmail = "",
  onBack,
  onCreateAccount,
}: {
  redirectTo?: string;
  desktop?: DesktopAuthQuery;
  defaultEmail?: string;
  onBack: () => void;
  onCreateAccount: (email: string) => void;
}) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = {
      email: isEmail(email) ? undefined : t("invalidEmail"),
      password: password.length >= MIN_PASSWORD ? undefined : t("passwordMin"),
    };
    setErrors(next);
    if (next.email || next.password) return;

    setPending(true);
    setFailure(null);
    try {
      const { error } = await authClient.signIn.email(
        { email: email.trim(), password },
        { query: desktop ? { ...desktop } : undefined },
      );
      if (error) {
        setPending(false);
        // 401 INVALID_EMAIL_OR_PASSWORD covers both a wrong password and an unknown email.
        // 429 is the API's per-address limit on sign-in attempts: say so, or the user retries.
        if (error.status === 429) setFailure("throttled");
        else setFailure(error.status === 401 || error.status === 400 ? "credentials" : "other");
        return;
      }
    } catch {
      setPending(false);
      setFailure("network");
      return;
    }
    if (desktop) {
      // Straight on: re-running the route first would flash the desktop page's "Continue as"
      // screen. The navigation reloads the session for the done page anyway.
      router.history.push(desktopDonePath(desktop));
      return;
    }
    await router.invalidate();
    // The helper validates `redirectTo` again, so a bad value cannot leave the site.
    router.history.push(resolvePostSignInPath({ redirect: redirectTo }));
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)}>
      <TextField
        first
        label={t("email")}
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        placeholder={t("emailPlaceholder")}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
        autoFocus
      />
      <PasswordField
        label={t("password")}
        name="password"
        autoComplete="current-password"
        placeholder={t("passwordPlaceholderSignIn")}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
        aside={
          <Link to="/auth/forgot-password" {...linkStyles.accent()}>
            {t("forgotPasswordShort")}
          </Link>
        }
      />
      {failure ? (
        <ErrorBanner>
          {failure === "credentials" ? (
            <>
              {t("wrongCredentials")}{" "}
              <AccentButton onClick={() => onCreateAccount(email.trim())}>
                {t("createWithThisEmail")}
              </AccentButton>
            </>
          ) : failure === "throttled" ? (
            t("tooManyAttempts")
          ) : failure === "network" ? (
            t("errorNetwork")
          ) : (
            t("signInFailed")
          )}
        </ErrorBanner>
      ) : null}
      <PrimaryButton type="submit" disabled={pending}>
        {pending ? t("submitting") : t("signIn")}
      </PrimaryButton>
      <QuietButton back block onClick={onBack}>
        {t("backToGoogle")}
      </QuietButton>
    </form>
  );
}
