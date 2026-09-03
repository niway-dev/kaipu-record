import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { Button } from "@renderer/ui/button";
import { Input } from "@renderer/ui/input";
import { Row } from "@renderer/ui/row";
import type { AuthError } from "@shared/types/auth";
import { useAuthStatus } from "./use-auth-status";
import styles from "./account-panel.module.css";

type FormMode = "closed" | "sign-in" | "sign-up";

function errorCopyKey(err: AuthError): string {
  switch (err.kind) {
    case "invalid-credentials":
      return "authErrorInvalidCredentials";
    case "email-taken":
      return "authErrorEmailTaken";
    case "network":
      return "authErrorNetwork";
    default:
      return "authErrorUnknown";
  }
}

export function AccountPanel(): React.JSX.Element {
  const t = useTranslations("settings");
  const { status, pending, error, refresh, signIn, signUp, signOut } = useAuthStatus();
  const [mode, setMode] = React.useState<FormMode>("closed");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");

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
    return (
      <div className={styles.actions}>
        <Button size="sm" onClick={() => setMode("sign-in")}>
          {t("signIn")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setMode("sign-up")}>
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
        <Button type="button" variant="ghost" size="sm" onClick={() => setMode("closed")}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
