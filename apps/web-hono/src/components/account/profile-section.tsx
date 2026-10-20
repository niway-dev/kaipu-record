import { useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { Check } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { authClient } from "@/lib/auth/auth-client";
import { kl, tone } from "../dashboard/dashboard.stylex";
import { Button, Card, Field, Tag } from "@/components/dashboard/ui";
import { VerificationNotice } from "./verification-notice";

export interface AccountUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}

const NAME_MAX = 80;

type NameStatus = "idle" | "saving" | "saved" | "failed" | "invalid";

export function ProfileSection({
  user,
  onSessionChanged,
}: {
  user: AccountUser;
  /** Re-reads everything that came from the session (header, badge, storage). */
  onSessionChanged: () => Promise<void>;
}) {
  const t = useTranslations("account");
  const [name, setName] = useState(user.name);
  const [nameStatus, setNameStatus] = useState<NameStatus>("idle");

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > NAME_MAX) {
      setNameStatus("invalid");
      return;
    }
    setNameStatus("saving");
    const result = await authClient.updateUser({ name: trimmed });
    if (result.error) {
      setNameStatus("failed");
      return;
    }
    setName(trimmed);
    setNameStatus("saved");
    await onSessionChanged();
  }

  return (
    <Card title={t("profileTitle")}>
      <form onSubmit={(e) => void saveName(e)} noValidate>
        <Field
          id="account-name"
          label={t("nameLabel")}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameStatus("idle");
          }}
          autoComplete="name"
          error={nameStatus === "invalid" ? t("nameInvalid") : null}
        />
        <div {...stylex.props(s.row)}>
          <Button
            type="submit"
            variant="pink"
            size="sm"
            disabled={nameStatus === "saving" || name.trim() === user.name}
          >
            {nameStatus === "saving" ? t("nameSaving") : t("nameSave")}
          </Button>
          {nameStatus === "saved" && (
            <p role="status" {...stylex.props(s.saved)}>
              <Check size={14} strokeWidth={2.4} aria-hidden />
              {t("nameSaved")}
            </p>
          )}
          {nameStatus === "failed" && (
            <p role="alert" {...stylex.props(s.failed)}>
              {t("nameSaveFailed")}
            </p>
          )}
        </div>
      </form>

      <div aria-hidden {...stylex.props(s.divider)} />

      <p {...stylex.props(s.label)}>{t("emailLabel")}</p>
      <div {...stylex.props(s.row)}>
        <span {...stylex.props(s.email)}>{user.email}</span>
        <Tag tone={user.emailVerified ? "ok" : "warn"}>
          {user.emailVerified ? t("emailVerified") : t("emailNotVerified")}
        </Tag>
      </div>

      {!user.emailVerified && (
        <div {...stylex.props(s.notice)}>
          <VerificationNotice user={user} onSessionChanged={onSessionChanged} />
        </div>
      )}
    </Card>
  );
}

const s = stylex.create({
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" },
  saved: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    margin: 0,
    fontSize: "13px",
    color: tone.green,
  },
  failed: { margin: 0, fontSize: "13px", color: tone.red },
  divider: { height: "1px", marginTop: "20px", marginBottom: "16px", backgroundColor: kl.bd },
  label: { margin: 0, marginBottom: "8px", fontSize: "13px", fontWeight: 600, color: kl.tx },
  email: {
    minWidth: 0,
    fontFamily: kl.fontMono,
    fontSize: "13.5px",
    color: kl.tx,
    overflowWrap: "anywhere",
  },
  notice: { marginTop: "16px" },
});
