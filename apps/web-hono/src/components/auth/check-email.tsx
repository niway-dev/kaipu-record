import { useEffect, useState, type ReactNode } from "react";
import { Mail } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";

import { authClient } from "@/lib/auth/auth-client";
import {
  AccentButton,
  GhostLink,
  HeroBody,
  HeroHeader,
  QuietButton,
  SmallPrint,
  Spaced,
  Strong,
} from "./auth-ui";

/** Seconds between two "Resend" presses; the first one counts from the sign-up itself. */
export const RESEND_COOLDOWN_S = 60;

/** `0:42`, the way the design prints the countdown. */
export function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The inbox to offer a shortcut to, when the address makes it obvious. */
function webmailFor(email: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain === "gmail.com" || domain === "googlemail.com" ? "https://mail.google.com/" : null;
}

/**
 * "Check your email", after a sign-up with email. The account already exists and is signed in;
 * the link only activates Kaipu Cloud, so this view never blocks anything: `children` carries the
 * way forward (the library on the web).
 *
 * Resend uses the same link email the sign-up sent (`sendVerificationEmail`), counted down so a
 * double press does not send two. "Wrong email? Change it" signs the new account out and reopens
 * the form with the details filled in, since the mistyped account cannot receive its link.
 */
export function CheckEmail({
  email,
  onChangeEmail,
  children,
}: {
  email: string;
  onChangeEmail: () => void;
  children?: ReactNode;
}) {
  const t = useTranslations("auth");
  // A deadline rather than a decrementing counter: a throttled background tab still shows the
  // right time when it wakes up.
  const [until, setUntil] = useState(() => Date.now() + RESEND_COOLDOWN_S * 1000);
  const [now, setNow] = useState(() => Date.now());
  const [resent, setResent] = useState(false);
  const [changing, setChanging] = useState(false);
  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  const counting = remaining > 0;

  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [counting]);

  async function resend() {
    const start = Date.now();
    setNow(start);
    setUntil(start + RESEND_COOLDOWN_S * 1000);
    await authClient
      .sendVerificationEmail({ email, callbackURL: "/auth/email-verified" })
      .catch(() => undefined);
    setResent(true);
  }

  async function changeEmail() {
    setChanging(true);
    await authClient.signOut().catch(() => undefined);
    onChangeEmail();
  }

  const webmail = webmailFor(email);

  return (
    <HeroHeader use="permissions" title={t("checkEmailTitle")}>
      <HeroBody>
        {t.rich("checkEmailBody", { email, b: (chunks) => <Strong>{chunks}</Strong> })}
      </HeroBody>
      <SmallPrint>{t("checkEmailLater")}</SmallPrint>
      {children}
      {webmail ? (
        <Spaced>
          <GhostLink
            href={webmail}
            target="_blank"
            rel="noopener noreferrer"
            icon={<Mail size={16} aria-hidden />}
          >
            {t("openGmail")}
          </GhostLink>
        </Spaced>
      ) : null}
      <SmallPrint>
        {`${t("resendPrompt")} `}
        {remaining > 0 ? (
          t("resendIn", { time: formatCountdown(remaining) })
        ) : (
          <AccentButton onClick={() => void resend()}>{t("resend")}</AccentButton>
        )}
      </SmallPrint>
      <SmallPrint live>{resent ? t("resendSent") : ""}</SmallPrint>
      <QuietButton block disabled={changing} onClick={() => void changeEmail()}>
        {t("changeEmail")}
      </QuietButton>
    </HeroHeader>
  );
}
