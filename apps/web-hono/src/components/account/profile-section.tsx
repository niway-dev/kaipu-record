import { useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@kaipu/web-ui";
import { authClient } from "@/lib/auth/auth-client";
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
    <Card>
      <CardHeader>
        <CardTitle>{t("profileTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={(e) => void saveName(e)} className="space-y-2" noValidate>
          <Label htmlFor="account-name">{t("nameLabel")}</Label>
          <div className="flex gap-2">
            <Input
              id="account-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameStatus("idle");
              }}
              autoComplete="name"
              aria-invalid={nameStatus === "invalid" || undefined}
            />
            <Button type="submit" disabled={nameStatus === "saving" || name.trim() === user.name}>
              {nameStatus === "saving" ? t("nameSaving") : t("nameSave")}
            </Button>
          </div>
          {nameStatus === "invalid" && (
            <p role="alert" className="text-destructive text-sm">
              {t("nameInvalid")}
            </p>
          )}
          {nameStatus === "failed" && (
            <p role="alert" className="text-destructive text-sm">
              {t("nameSaveFailed")}
            </p>
          )}
          {nameStatus === "saved" && (
            <p role="status" className="text-muted-foreground text-sm">
              {t("nameSaved")}
            </p>
          )}
        </form>

        <div className="space-y-2">
          <Label>{t("emailLabel")}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <span>{user.email}</span>
            <Badge variant={user.emailVerified ? "secondary" : "outline"}>
              {user.emailVerified ? t("emailVerified") : t("emailNotVerified")}
            </Badge>
          </div>
        </div>

        {!user.emailVerified && (
          <VerificationNotice user={user} onSessionChanged={onSessionChanged} />
        )}
      </CardContent>
    </Card>
  );
}
