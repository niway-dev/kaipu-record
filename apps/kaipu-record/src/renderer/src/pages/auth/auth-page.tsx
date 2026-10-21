import React, { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import * as stylex from "@stylexjs/stylex";
import { planCopyValues } from "@kaipu/domain/constants";
import { useTranslations } from "@kaipu/i18n";
import { KaipuLogo } from "@kaipu/brand";
import { Button, Input } from "@kaipu/ui";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import type { AuthError } from "@shared/types/auth";
import { useAuthStatus } from "@renderer/features/auth/use-auth-status";
import styles from "./auth-page.module.css";

/** The shared Button takes StyleX styles, not a className (its classes are atomic). */
const sx = stylex.create({
  full: {
    width: "100%",
  },
  gapTop: {
    marginTop: tokens.spaceXs,
  },
});

/** Public website that hosts the legal documents. */
const LEGAL_WEB_URL = (import.meta.env.VITE_PUBLIC_WEB_URL ?? "https://kaipu.app").replace(
  /\/$/,
  "",
);

/** Where the user is sent back to (Back, or a successful sign-in) when nothing sent them here. */
const DEFAULT_RETURN_TO = "/settings";

/** Navigation state the Settings / Cloud "Sign in" buttons attach. */
export interface AuthPageLocationState {
  from?: string;
}

/** Exhaustive on purpose — no `default` branch, so adding an AuthError kind without adding its
 *  copy here is a compile error rather than a silent fallback to the generic message. */
function errorCopyKey(
  err: AuthError,
):
  | "errorStateMismatch"
  | "errorInvalidCode"
  | "errorTooManyAttempts"
  | "errorNotConfigured"
  | "errorNetwork"
  | "errorUnknown" {
  switch (err.kind) {
    case "state-mismatch":
      return "errorStateMismatch";
    case "invalid-code":
      return "errorInvalidCode";
    case "throttled":
      return "errorTooManyAttempts";
    case "not-configured":
      return "errorNotConfigured";
    case "network":
      return "errorNetwork";
    case "unknown":
      return "errorUnknown";
  }
}

/**
 * Full-window sign-in screen (no sidebar — it's a sibling of AppShell, see app/router.tsx).
 * There is no password field: "Sign in" hands the user to the Kaipu website in the system
 * browser, which returns to the app through a `kaipu://` link. Where that link cannot reach the
 * app (a dev build, a blocked deep link), the code the web page shows is pasted here instead.
 *
 * Leaves the page as soon as the status is `signed-in` — whether from the link, the pasted
 * code, or because the user was already signed in when they landed here — to the route that
 * sent them (`location.state.from`), or Settings by default.
 */
export function AuthPage(): React.JSX.Element {
  const t = useTranslations("auth");
  const legal = useTranslations("legal");
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as AuthPageLocationState | null)?.from ?? DEFAULT_RETURN_TO;
  const {
    status,
    pending,
    error,
    phase,
    submittingCode,
    startBrowserSignIn,
    cancelBrowserSignIn,
    submitCode,
  } = useAuthStatus();
  const [intent, setIntent] = useState<"sign-in" | "sign-up">("sign-in");
  const [code, setCode] = useState("");

  useEffect(() => {
    if (status.kind === "signed-in") navigate(from, { replace: true });
  }, [status.kind, from, navigate]);

  const begin = (next: "sign-in" | "sign-up"): void => {
    setIntent(next);
    void startBrowserSignIn(next);
  };

  const waiting = phase === "waiting";

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
            <KaipuLogo use="product" size={36} />
          </span>
          <h1 className={styles.title}>{t(waiting ? "waitingTitle" : "browserTitle")}</h1>
          <p className={styles.subtitle}>{t(waiting ? "waitingSubtitle" : "browserSubtitle")}</p>
          <p className={styles.cloudTerms}>
            <strong>{t("cloudPromotion", planCopyValues())}</strong> {t("cloudPromotionNote")}{" "}
            <a
              href={`${LEGAL_WEB_URL}/legal/cloud-terms`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {legal("readTerms")}
            </a>
          </p>

          {error && (
            <p className={styles.error} role="alert">
              {t(errorCopyKey(error))}
            </p>
          )}

          {waiting ? (
            <div className={styles.actions}>
              <Button variant="outline" size="lg" style={sx.full} onClick={() => begin(intent)}>
                {t("openBrowserAgain")}
              </Button>
              <form
                className={styles.codeForm}
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitCode(code);
                }}
              >
                <p className={styles.hint}>{t("pasteCodeHint")}</p>
                <Input
                  id="auth-code"
                  label={t("codeLabel")}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <Button
                  type="submit"
                  size="lg"
                  style={sx.full}
                  disabled={submittingCode || !code.trim()}
                >
                  {t(submittingCode ? "submittingCode" : "submitCode")}
                </Button>
              </form>
              <Button
                variant="ghost"
                size="sm"
                style={sx.gapTop}
                onClick={() => {
                  setCode("");
                  void cancelBrowserSignIn();
                }}
              >
                {t("cancel")}
              </Button>
            </div>
          ) : (
            <div className={styles.actions}>
              <Button size="lg" style={sx.full} disabled={pending} onClick={() => begin("sign-in")}>
                {t("signInWithBrowser")}
              </Button>
              <p className={styles.switch}>
                {t("needAccount")}{" "}
                <button
                  type="button"
                  className={styles.switchLink}
                  disabled={pending}
                  onClick={() => begin("sign-up")}
                >
                  {t("signUp")}
                </button>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
