import { useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { useRouter } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";

import { SignupLegalNotice } from "@/components/legal/signup-legal-notice";
import { setPrefillEmail, takePrefillEmail } from "@/lib/auth-prefill";
import { authTabHrefs, type DesktopAuthQuery } from "@/lib/desktop-auth";
import { signInOAuthErrorKey } from "@/lib/google-auth";
import { resolvePostSignInPath } from "@/lib/post-sign-in";
import { kl } from "./auth.stylex";
import {
  AccountOptionalNote,
  AuthHeading,
  AuthLead,
  DesktopWaitingBanner,
  EmailRevealButton,
  ErrorBanner,
  OrDivider,
  PrimaryLink,
} from "./auth-ui";
import { CheckEmail } from "./check-email";
import { GoogleButton } from "./google-button";
import SignInForm from "./sign-in-form";
import SignUpForm, { type SignUpValues } from "./sign-up-form";
import { useDesktopPlatform } from "./use-desktop-platform";

export type AuthMode = "sign-in" | "sign-up";

/**
 * The "Sign in" / "Create account" page of the design, shared by `/auth/login`, `/auth/signup`
 * and `/auth/desktop`. One layout for both tabs: the big Google button first, then "or", then the
 * email form behind "Continue with email" — it exists, but it does not compete.
 *
 * The tabs are links, not in-page state, so each tab has its own URL and every query parameter the
 * visitor arrived with (`redirect`, or the desktop app's `client_id`, `state`, `code_challenge`)
 * survives the switch. `desktop` is the app's query when the desktop app opened the page; it shows
 * the "Kaipu Record is waiting" banner and is forwarded with every request.
 */
export function AuthPanel({
  mode,
  redirectTo,
  desktop,
  oauthError,
}: {
  mode: AuthMode;
  redirectTo?: string;
  desktop?: DesktopAuthQuery;
  oauthError?: string;
}) {
  const t = useTranslations("auth");
  const router = useRouter();
  const signUp = mode === "sign-up";
  // Set by the sign-in form's "Create an account with this email"; read once, client side only.
  const [prefill] = useState(() => (signUp ? takePrefillEmail() : null));
  const [emailOpen, setEmailOpen] = useState(prefill !== null);
  const [values, setValues] = useState<Partial<SignUpValues>>({ email: prefill ?? undefined });
  const [signedUp, setSignedUp] = useState<string | null>(null);
  const platform = useDesktopPlatform(!!desktop);
  const tabs = authTabHrefs({ redirect: redirectTo, desktop });

  if (signedUp) {
    return (
      <CheckEmail
        email={signedUp}
        onChangeEmail={() => {
          setValues((v) => ({ ...v, email: signedUp }));
          setSignedUp(null);
          setEmailOpen(true);
        }}
      >
        {/* A full page load on purpose: it is what reads the session the sign-up just set. */}
        <PrimaryLink href={resolvePostSignInPath({ redirect: redirectTo })} large>
          {t("goToLibrary")}
        </PrimaryLink>
      </CheckEmail>
    );
  }

  function createAccountWith(email: string) {
    setPrefillEmail(email);
    router.history.push(tabs.signUp);
  }

  return (
    <div>
      {desktop ? <DesktopWaitingBanner platform={platform} /> : null}
      <AuthHeading>{signUp ? t("signUpHeading") : t("signInHeading")}</AuthHeading>
      <AuthLead>{signUp ? t("signUpSubtitle") : t("signInSubtitle")}</AuthLead>

      <nav aria-label={t("authTabsLabel")} {...stylex.props(s.tabs)}>
        <TabLink href={tabs.signIn} current={!signUp} label={t("signIn")} />
        <TabLink href={tabs.signUp} current={signUp} label={t("signUp")} />
      </nav>

      {emailOpen ? (
        signUp ? (
          <SignUpForm
            desktop={desktop}
            defaultValues={values}
            onBack={() => setEmailOpen(false)}
            onSignedUp={(email) => setSignedUp(email)}
          />
        ) : (
          <SignInForm
            redirectTo={redirectTo}
            desktop={desktop}
            onBack={() => setEmailOpen(false)}
            onCreateAccount={createAccountWith}
          />
        )
      ) : (
        <>
          <GoogleButton mode={mode} redirectTo={redirectTo} desktop={desktop} />
          <OrDivider />
          <EmailRevealButton onClick={() => setEmailOpen(true)}>
            {signUp ? t("signUpWithEmail") : t("continueWithEmail")}
          </EmailRevealButton>
        </>
      )}

      {oauthError ? <ErrorBanner>{t(signInOAuthErrorKey(oauthError))}</ErrorBanner> : null}
      {emailOpen ? null : <AccountOptionalNote />}
      <div {...stylex.props(s.legal)}>
        <SignupLegalNotice
          messageKey={signUp ? (emailOpen ? "signupNotice" : "googleSignupNotice") : "signinNotice"}
          tone="inherit"
        />
      </div>
    </div>
  );
}

/**
 * One tab. A real link (so it can be opened in a new tab, and works before hydration) that the
 * router takes over on a plain click. `aria-current` marks the page the visitor is on.
 */
function TabLink({ href, current, label }: { href: string; current: boolean; label: string }) {
  const router = useRouter();
  return (
    <a
      href={href}
      aria-current={current ? "page" : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (!current) router.history.push(href);
      }}
      {...stylex.props(s.tab, current && s.tabCurrent)}
    >
      {label}
    </a>
  );
}

const s = stylex.create({
  tabs: {
    display: "flex",
    gap: "3px",
    marginBottom: "24px",
    padding: "3px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: kl.bd,
    borderRadius: "999px",
    backgroundColor: kl.card2,
  },
  tab: {
    flex: 1,
    height: "36px",
    lineHeight: "36px",
    borderRadius: "999px",
    textAlign: "center",
    fontSize: "14px",
    fontWeight: 600,
    color: { default: kl.dim, ":hover": kl.tx },
    textDecoration: "none",
    outline: { default: "none", ":focus-visible": "2px solid #f6055c" },
    outlineOffset: "2px",
  },
  tabCurrent: {
    backgroundColor: kl.card,
    color: kl.tx,
    boxShadow: "0 1px 0 var(--kl-bd-2), 0 4px 12px -6px rgba(0, 0, 0, 0.35)",
  },
  legal: {
    marginTop: "22px",
    textAlign: "center",
    color: kl.faint,
  },
});
