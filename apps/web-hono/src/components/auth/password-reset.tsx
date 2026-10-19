import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "@kaipu/i18n";

import { authClient } from "@/lib/auth/auth-client";
import {
  AuthHeading,
  BackRow,
  AuthLead,
  ErrorBanner,
  HeroBody,
  HeroHeader,
  linkStyles,
  PasswordField,
  PrimaryButton,
  TextField,
} from "./auth-ui";
import { isEmail, MIN_PASSWORD } from "./validation";

function BackToSignIn() {
  const t = useTranslations("auth");
  return (
    <BackRow>
      <Link to="/auth/login" {...linkStyles.quiet()}>
        <ArrowLeft size={14} aria-hidden />
        {t("backToSignIn")}
      </Link>
    </BackRow>
  );
}

/**
 * `/auth/forgot-password`, the design's "Reset your password". The answer is the same whether or
 * not the email has an account, so the page never says which.
 */
export function ForgotPassword() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isEmail(email)) {
      setError(t("invalidEmail"));
      return;
    }
    setError(undefined);
    setPending(true);
    // Always report success — never reveal whether the account exists.
    await authClient
      .requestPasswordReset({ email: email.trim(), redirectTo: "/auth/reset-password" })
      .catch(() => undefined);
    setPending(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div>
        <BackToSignIn />
        <HeroHeader use="permissions" title={t("forgotSentTitle")}>
          <div aria-live="polite">
            <HeroBody>{t("forgotSent")}</HeroBody>
          </div>
        </HeroHeader>
      </div>
    );
  }

  return (
    <div>
      <BackToSignIn />
      <AuthHeading compact>{t("forgotTitle")}</AuthHeading>
      <AuthLead>{t("forgotBody")}</AuthLead>
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
          error={error}
          autoFocus
        />
        <PrimaryButton type="submit" disabled={pending}>
          {pending ? t("submitting") : t("forgotSubmit")}
        </PrimaryButton>
      </form>
    </div>
  );
}

/** `/auth/reset-password?token=…`, where the emailed link lands. */
export function ResetPassword({ token }: { token?: string }) {
  const t = useTranslations("auth");
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <div>
        <AuthHeading compact>{t("resetTitle")}</AuthHeading>
        <AuthLead>{t("resetMissingToken")}</AuthLead>
        <Link to="/auth/forgot-password" {...linkStyles.accent()}>
          {t("forgotTitle")}
        </Link>
      </div>
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setFieldError(t("passwordMin"));
      return;
    }
    setFieldError(undefined);
    setPending(true);
    setInvalid(false);
    const result = await authClient.resetPassword({ newPassword: password, token: token! });
    setPending(false);
    if (result.error) {
      setInvalid(true);
      return;
    }
    toast.success(t("resetSuccess"));
    // Success: all sessions were revoked server-side; go sign in again.
    void navigate({ to: "/auth/login" });
  }

  return (
    <div>
      <BackToSignIn />
      <AuthHeading compact>{t("resetTitle")}</AuthHeading>
      <AuthLead>{t("passwordHint")}</AuthLead>
      <form noValidate onSubmit={(e) => void submit(e)}>
        <PasswordField
          label={t("password")}
          name="password"
          autoComplete="new-password"
          placeholder={t("passwordPlaceholderSignUp")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldError}
          autoFocus
        />
        {invalid ? (
          <ErrorBanner>
            {t("resetInvalid")}{" "}
            <Link to="/auth/forgot-password" {...linkStyles.accent()}>
              {t("forgotTitle")}
            </Link>
          </ErrorBanner>
        ) : null}
        <PrimaryButton type="submit" disabled={pending}>
          {pending ? t("submitting") : t("resetSubmit")}
        </PrimaryButton>
      </form>
    </div>
  );
}
