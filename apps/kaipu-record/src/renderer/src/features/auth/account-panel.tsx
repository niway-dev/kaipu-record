import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { Button } from "@renderer/ui/button";
import { Input } from "@renderer/ui/input";
import { Row } from "@renderer/ui/row";
import type { AuthError } from "@shared/types/auth";
import { useAuthStatus } from "./use-auth-status";
import styles from "./account-panel.module.css";

type FormMode = "closed" | "sign-in" | "sign-up";

/** Exhaustive on purpose — no `default` branch, so adding an AuthError kind without adding its
 *  copy here is a compile error rather than a silent fallback to the generic message. */
function errorCopyKey(
  err: AuthError,
):
  | "authErrorInvalidCredentials"
  | "authErrorEmailTaken"
  | "authErrorPasswordTooShort"
  | "authErrorNetwork"
  | "authErrorUnknown" {
  switch (err.kind) {
    case "invalid-credentials":
      return "authErrorInvalidCredentials";
    case "email-taken":
      return "authErrorEmailTaken";
    case "password-too-short":
      return "authErrorPasswordTooShort";
    case "network":
      return "authErrorNetwork";
    case "unknown":
      return "authErrorUnknown";
  }
}

export function AccountPanel(): React.JSX.Element {
  const t = useTranslations("settings");
  const { status, pending, error, refresh, signIn, signUp, signOut, clearError } = useAuthStatus();
  const [mode, setMode] = React.useState<FormMode>("closed");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");

  // A successful sign-in/sign-up leaves `mode` at whatever the user opened ("sign-in" or
  // "sign-up") — nothing else ever resets it. Without this, a later sign-out re-renders the
  // stale, still-open form (with the old email/password still filled in) instead of the
  // closed "Sign in"/"Create account" buttons, since `mode === "closed"` is what that branch
  // requires. Reset on the signed-in transition, not on sign-out itself, so it's already
  // "closed" by the time signed-out re-renders.
  React.useEffect(() => {
    if (status.kind !== "signed-in") return;
    setMode("closed");
    setEmail("");
    setPassword("");
    setName("");
  }, [status.kind]);

  // The error lives in useAuthStatus and is otherwise only cleared by a NEW attempt, so
  // cancelling or switching between sign-in and sign-up would leave the previous form's error
  // sitting above the fresh one. Every user-driven mode change goes through here.
  const openForm = (next: FormMode): void => {
    clearError();
    setMode(next);
  };

  if (status.kind === "signed-in") {
    return (
      <Row
        label={status.email}
        action={
          <Button variant="outline" size="sm" onClick={() => void signOut()}>
            {t("signOut")}
          </Button>
        }
      />
    );
  }

  if (status.kind === "unknown") {
    return (
      <Row
        label={status.lastKnownEmail ?? ""}
        description={<span className={styles.unknownNote}>{t("accountUnknown")}</span>}
        action={
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            {t("retry")}
          </Button>
        }
      />
    );
  }

  if (mode === "closed") {
    // `pending` is true until the initial getAuthStatus() round-trip resolves (see
    // use-auth-status.ts). Rendering nothing for that brief window avoids flashing the
    // signed-out buttons for a user who turns out to already be signed in.
    if (pending) return <></>;
    return (
      <div className={styles.actions}>
        <Button size="sm" onClick={() => openForm("sign-in")}>
          {t("signIn")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => openForm("sign-up")}>
          {t("signUp")}
        </Button>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (mode === "sign-in") void signIn({ email, password });
    else void signUp({ email, password, name });
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <Input
        id="account-email"
        label={t("emailLabel")}
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      {mode === "sign-up" && (
        <Input
          id="account-name"
          label={t("nameLabel")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      )}
      <Input
        id="account-password"
        label={t("passwordLabel")}
        type="password"
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
      <div className={styles.formActions}>
        <Button type="submit" size="sm" disabled={pending}>
          {t("submit")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => openForm("closed")}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
