import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "@kaipu/i18n";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@kaipu/web-ui";
import type {
  AccountDeletionClient,
  DeletionFailure,
  DeletionImpact,
  DeletionStatus,
} from "@/lib/account-deletion";
import { Notice } from "./notice";

type Scheduled = Extract<DeletionStatus, { status: "scheduled" }>;

const SIGN_IN_AGAIN = "/auth/login?redirect=%2Faccount";

export interface DangerZoneProps {
  email: string;
  /** Accounts with a password type it too; a Google-only account confirms with a fresh session. */
  hasPassword: boolean;
  /** While false the section renders a disabled button (the server side is NIW2-214 / #268). */
  enabled: boolean;
  client: AccountDeletionClient;
}

export function DangerZone({ email, hasPassword, enabled, client }: DangerZoneProps) {
  const t = useTranslations("account");
  const format = useFormatter();
  const [scheduled, setScheduled] = useState<Scheduled | null>(null);
  const [impact, setImpact] = useState<DeletionImpact | undefined>();
  const [open, setOpen] = useState(false);
  const [typedEmail, setTypedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<DeletionFailure | null>(null);
  const [restore, setRestore] = useState<"idle" | "pending" | "failed" | "done">("idle");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    client
      .getDeletionStatus()
      .then((status) => {
        if (cancelled) return;
        if (status.status === "scheduled") setScheduled(status);
        else setImpact(status.impact);
      })
      // An unreadable status must not hide the section: the delete request is idempotent.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, enabled]);

  const date = (iso: string): string => format.dateTime(new Date(iso), { dateStyle: "long" });

  function reset() {
    setTypedEmail("");
    setPassword("");
    setFailure(null);
    setPending(false);
  }

  const emailMatches = typedEmail === email;
  const canConfirm = emailMatches && (!hasPassword || password.length > 0) && !pending;

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canConfirm) return;
    setPending(true);
    setFailure(null);
    const result = await client.requestDeletion({ password: hasPassword ? password : undefined });
    setPending(false);
    if (!result.ok) {
      setFailure(result.reason);
      return;
    }
    setScheduled(result.status);
    setRestore("idle");
    setOpen(false);
    reset();
  }

  async function restoreAccount() {
    setRestore("pending");
    try {
      await client.cancelDeletion();
      setScheduled(null);
      setRestore("done");
    } catch {
      setRestore("failed");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-destructive">{t("dangerTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">{t("dangerDescription")}</p>

        {restore === "done" && <Notice title={t("restored")} />}

        {scheduled ? (
          <div className="space-y-3">
            <Notice
              tone="destructive"
              title={t("deleteScheduled", { date: date(scheduled.scheduledAt) })}
              detail={t("deleteScheduledDetail")}
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void restoreAccount()}
                  disabled={restore === "pending"}
                >
                  {restore === "pending" ? t("restoring") : t("restore")}
                </Button>
              }
            />
            {restore === "failed" && (
              <p role="alert" className="text-destructive text-sm">
                {t("restoreFailed")}
              </p>
            )}
          </div>
        ) : !enabled ? (
          <Button variant="destructive" disabled>
            {t("deleteComingSoon")}
          </Button>
        ) : (
          <Button variant="destructive" onClick={() => setOpen(true)}>
            {t("deleteAccount")}
          </Button>
        )}
      </CardContent>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent>
          <form onSubmit={(e) => void confirm(e)} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>{t("deleteDialogTitle")}</DialogTitle>
              <DialogDescription>{t("deleteDialogIntro")}</DialogDescription>
            </DialogHeader>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>{t("deletesProfile")}</li>
              <li>{t("deletesCloud")}</li>
              <li>{t("deletesSignIn")}</li>
            </ul>
            {impact && (
              <p className="text-sm font-medium">
                {t("deleteImpact", {
                  cloudFiles: impact.cloudFiles,
                  pendingUploads: impact.pendingUploads,
                })}
              </p>
            )}
            <p className="text-muted-foreground text-sm">{t("deleteLocalKept")}</p>
            <p className="text-muted-foreground text-sm">{t("deleteGrace")}</p>

            <div className="space-y-2">
              <Label htmlFor="delete-email">{t("deleteTypeEmail", { email })}</Label>
              <Input
                id="delete-email"
                value={typedEmail}
                onChange={(e) => setTypedEmail(e.target.value)}
                autoComplete="off"
                placeholder={t("deleteEmailLabel")}
              />
            </div>
            {hasPassword && (
              <div className="space-y-2">
                <Label htmlFor="delete-password">{t("deletePasswordLabel")}</Label>
                <Input
                  id="delete-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  aria-invalid={failure === "wrong-password" || undefined}
                />
              </div>
            )}

            {failure === "wrong-password" && (
              <p role="alert" className="text-destructive text-sm">
                {t("deleteWrongPassword")}
              </p>
            )}
            {failure === "session-not-fresh" && (
              <p role="alert" className="text-destructive text-sm">
                {t("deleteNotFresh")}{" "}
                <a className="underline" href={SIGN_IN_AGAIN}>
                  {t("deleteSignInAgain")}
                </a>
              </p>
            )}
            {failure === "failed" && (
              <p role="alert" className="text-destructive text-sm">
                {t("deleteFailed")}
              </p>
            )}

            <DialogFooter showCloseButton={false}>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={!canConfirm}>
                {pending ? t("deleteWorking") : t("deleteConfirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
