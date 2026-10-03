import React from "react";
import { useNavigate } from "react-router-dom";
import { useTranslations } from "@kaipu/i18n";
import { Button } from "@kaipu/ui";
import { Row } from "@kaipu/ui";
import type { AuthPageLocationState } from "@renderer/pages/auth/auth-page";
import type { AuthStatus } from "@shared/types/auth";
import { useAuthStatus } from "./use-auth-status";
import styles from "./account-panel.module.css";

/** Where the auth pages send the user back to (Back, or a successful sign-in). */
const RETURN_TO: AuthPageLocationState = { from: "/cloud" };

/** Account status and the entry point to the promotional Cloud offer. */
export function AccountPanel({
  statusOverride,
}: {
  /** Show this status instead of the real one (the dev storage simulator). */
  statusOverride?: AuthStatus;
} = {}): React.JSX.Element {
  const t = useTranslations("settings");
  const navigate = useNavigate();
  const auth = useAuthStatus();
  const { refresh, signOut } = auth;
  const status = statusOverride ?? auth.status;
  const pending = statusOverride ? false : auth.pending;

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

  // `pending` is true until the initial getAuthStatus() round-trip resolves (see
  // use-auth-status.ts). Rendering nothing for that brief window avoids flashing the
  // signed-out row for a user who turns out to already be signed in.
  if (pending) return <></>;
  return (
    <Row
      label={t("accountTitle")}
      description={<span className={styles.accountNote}>{t("accountDescription")}</span>}
      action={
        <Button size="sm" onClick={() => navigate("/sign-in", { state: RETURN_TO })}>
          {t("signIn")}
        </Button>
      }
    />
  );
}
