import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { Button } from "@renderer/ui/button";
import { Input } from "@renderer/ui/input";
import type { AuthCredentials, AuthError, SignUpInput } from "@shared/types/auth";
import styles from "./auth-form.module.css";

export type AuthFormMode = "sign-in" | "sign-up";

export interface AuthFormProps {
  mode: AuthFormMode;
  /** Disables submit — covers both the in-flight attempt and the initial status load. */
  pending: boolean;
  error: AuthError | null;
  onSignIn(credentials: AuthCredentials): void;
  onSignUp(input: SignUpInput): void;
}

/** Exhaustive on purpose — no `default` branch, so adding an AuthError kind without adding its
 *  copy here is a compile error rather than a silent fallback to the generic message. */
function errorCopyKey(
  err: AuthError,
):
  | "errorInvalidCredentials"
  | "errorEmailTaken"
  | "errorPasswordTooShort"
  | "errorNetwork"
  | "errorUnknown" {
  switch (err.kind) {
    case "invalid-credentials":
      return "errorInvalidCredentials";
    case "email-taken":
      return "errorEmailTaken";
    case "password-too-short":
      return "errorPasswordTooShort";
    case "network":
      return "errorNetwork";
    case "unknown":
      return "errorUnknown";
  }
}

/** Submit label per mode: idle, and while the attempt is in flight. */
const SUBMIT_COPY: Record<
  AuthFormMode,
  { idle: "signIn" | "signUp"; pending: "signingIn" | "creatingAccount" }
> = {
  "sign-in": { idle: "signIn", pending: "signingIn" },
  "sign-up": { idle: "signUp", pending: "creatingAccount" },
};

/**
 * The email/password (+ name on sign-up) form, presentational: the owner runs the attempt
 * and passes `pending`/`error` back in. Keep it mounted across a sign-in ↔ sign-up switch:
 * the email carries over (someone who finds out they need an account shouldn't retype it)
 * while the password and name reset, since they belong to the attempt that was abandoned.
 */
export function AuthForm({
  mode,
  pending,
  error,
  onSignIn,
  onSignUp,
}: AuthFormProps): React.JSX.Element {
  const t = useTranslations("auth");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");

  React.useEffect(() => {
    setPassword("");
    setName("");
  }, [mode]);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (mode === "sign-in") onSignIn({ email, password });
    else onSignUp({ email, password, name });
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <Input
        id="auth-email"
        label={t("email")}
        type="email"
        autoComplete="email"
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      {mode === "sign-up" && (
        <Input
          id="auth-name"
          label={t("name")}
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      )}
      <Input
        id="auth-password"
        label={t("password")}
        type="password"
        autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        // Cheap client-side prevention of the server's PASSWORD_TOO_SHORT (better-auth's default
        // minimum is 8, and baseConfig does not override it). Sign-in keeps no minimum: an
        // existing account may predate the rule, and rejecting it here would only hide the
        // real "wrong email or password" answer behind a misleading validation message.
        minLength={mode === "sign-up" ? 8 : undefined}
      />
      {error && (
        <p className={styles.error} role="alert">
          {t(errorCopyKey(error))}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending} className={styles.submit}>
        {t(pending ? SUBMIT_COPY[mode].pending : SUBMIT_COPY[mode].idle)}
      </Button>
    </form>
  );
}
