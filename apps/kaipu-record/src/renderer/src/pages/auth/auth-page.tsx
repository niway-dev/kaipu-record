import React, { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslations } from "@kaipu/i18n";
import { KaipuMark } from "@renderer/shell/kaipu-mark";
import { AuthForm, type AuthFormMode } from "@renderer/features/auth/auth-form";
import { useAuthStatus } from "@renderer/features/auth/use-auth-status";
import styles from "./auth-page.module.css";

/** Where the user is sent back to (Back, or a successful sign-in) when nothing sent them here. */
const DEFAULT_RETURN_TO = "/settings";

/** Navigation state the Settings "Sign in" / "Create account" buttons attach. */
export interface AuthPageLocationState {
  from?: string;
}

const COPY: Record<
  AuthFormMode,
  {
    title: "welcomeBack" | "createAccount";
    subtitle: "signInSubtitle" | "signUpSubtitle";
    switchPrompt: "needAccount" | "haveAccount";
    switchLabel: "signUp" | "signIn";
    switchTo: "/sign-up" | "/sign-in";
  }
> = {
  "sign-in": {
    title: "welcomeBack",
    subtitle: "signInSubtitle",
    switchPrompt: "needAccount",
    switchLabel: "signUp",
    switchTo: "/sign-up",
  },
  "sign-up": {
    title: "createAccount",
    subtitle: "signUpSubtitle",
    switchPrompt: "haveAccount",
    switchLabel: "signIn",
    switchTo: "/sign-in",
  },
};

/**
 * Full-window sign-in / sign-up screen (no sidebar — it's a sibling of AppShell, see
 * app/router.tsx). Both routes render this one component with a different `mode`, so
 * switching between them keeps the auth hook (and its in-flight state) mounted.
 *
 * Leaves the page as soon as the status is `signed-in` — whether from this form, from a
 * broadcast, or because the user was already signed in when they landed here — to the
 * route that sent them (`location.state.from`), or Settings by default.
 */
export function AuthPage({ mode }: { mode: AuthFormMode }): React.JSX.Element {
  const t = useTranslations("auth");
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as AuthPageLocationState | null)?.from ?? DEFAULT_RETURN_TO;
  const { status, pending, error, signIn, signUp, clearError } = useAuthStatus();
  const copy = COPY[mode];

  useEffect(() => {
    if (status.kind === "signed-in") navigate(from, { replace: true });
  }, [status.kind, from, navigate]);

  // The error belongs to the form the user just left; the hook only clears it on a new attempt.
  useEffect(() => clearError(), [mode, clearError]);

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <button type="button" className={styles.back} onClick={() => navigate(from)}>
          <ArrowLeft size={17} strokeWidth={2} /> {t("back")}
        </button>
      </div>
      <div className={styles.stage}>
        <div className={styles.card}>
          <span className={styles.mark}>
            <KaipuMark size={36} />
          </span>
          <h1 className={styles.title}>{t(copy.title)}</h1>
          <p className={styles.subtitle}>{t(copy.subtitle)}</p>
          <AuthForm
            key={mode}
            mode={mode}
            pending={pending}
            error={error}
            onSignIn={(credentials) => void signIn(credentials)}
            onSignUp={(input) => void signUp(input)}
          />
          <p className={styles.switch}>
            {t(copy.switchPrompt)}{" "}
            <Link to={copy.switchTo} state={{ from }} className={styles.switchLink}>
              {t(copy.switchLabel)}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
