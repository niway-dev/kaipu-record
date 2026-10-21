import { useState } from "react";
import { useTranslations } from "@kaipu/i18n";

import { authClient } from "@/lib/auth/auth-client";
import { FormBlock, HeroBody, HeroHeader, PrimaryButton, PrimaryLink, TextField } from "./auth-ui";
import { isEmail } from "./validation";

/**
 * `/auth/email-verified`, where the verification link lands. Verification is by link
 * (`emailVerification` on the API, 24 hours), so this page serves every link ever sent, from the
 * web sign-up and from the desktop app's "Resend verification email" alike. A broken or expired
 * link (`?error=`) offers a new one.
 */
export function EmailVerified({ error }: { error?: string }) {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [resent, setResent] = useState(false);
  const [pending, setPending] = useState(false);

  if (!error) {
    return (
      <HeroHeader use="done" title={t("verifiedTitle")}>
        <HeroBody>{t("verifiedBody")}</HeroBody>
        <PrimaryLink href="/auth/login" large>
          {t("signIn")}
        </PrimaryLink>
      </HeroHeader>
    );
  }

  async function resend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isEmail(email)) {
      setFieldError(t("invalidEmail"));
      return;
    }
    setFieldError(undefined);
    setPending(true);
    await authClient
      .sendVerificationEmail({ email: email.trim(), callbackURL: "/auth/email-verified" })
      .catch(() => undefined);
    setPending(false);
    setResent(true);
  }

  return (
    <HeroHeader use="permissions" title={t("verifiedError")}>
      <div aria-live="polite">
        {resent ? (
          <HeroBody>{t("verifiedResendSent")}</HeroBody>
        ) : (
          <form noValidate onSubmit={(e) => void resend(e)}>
            <FormBlock>
              <TextField
                first
                label={t("email")}
                type="email"
                name="email"
                autoComplete="email"
                placeholder={t("emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={fieldError}
              />
            </FormBlock>
            <PrimaryButton type="submit" disabled={pending}>
              {pending ? t("submitting") : t("verifiedResend")}
            </PrimaryButton>
          </form>
        )}
      </div>
    </HeroHeader>
  );
}
