import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "@kaipu/i18n";
import * as stylex from "@stylexjs/stylex";
import { Check, Trash2 } from "lucide-react";
import type {
  AccountDeletionClient,
  DeletionFailure,
  DeletionImpact,
  DeletionStatus,
} from "@/lib/account-deletion";
import { kl, tone } from "../dashboard/dashboard.stylex";
import { Button, Card, Dialog, Field, Notice, Tag } from "@/components/dashboard/ui";

type Scheduled = Extract<DeletionStatus, { status: "scheduled" }>;

const SIGN_IN_AGAIN = "/auth/login?redirect=%2Fdashboard%2Fsettings";

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

  const close = () => {
    setOpen(false);
    reset();
  };

  return (
    <Card title={t("dangerTitle")} danger>
      {restore === "done" && (
        <div {...stylex.props(s.gap)}>
          <Notice icon={<Check size={18} />} title={t("restored")} />
        </div>
      )}

      {scheduled ? (
        <>
          <Notice
            tone="danger"
            icon={<Trash2 size={18} />}
            title={t("deleteScheduled", { date: date(scheduled.scheduledAt) })}
            detail={t("deleteScheduledDetail")}
            actions={
              <Button
                size="sm"
                variant="pink"
                onClick={() => void restoreAccount()}
                disabled={restore === "pending"}
              >
                {restore === "pending" ? t("restoring") : t("restore")}
              </Button>
            }
          />
          {restore === "failed" && (
            <p role="alert" {...stylex.props(s.error, s.errorBelow)}>
              {t("restoreFailed")}
            </p>
          )}
        </>
      ) : (
        <div {...stylex.props(s.row)}>
          <p {...stylex.props(s.description)}>{t("dangerDescription")}</p>
          {enabled ? (
            <Button variant="dangerOutline" onClick={() => setOpen(true)}>
              {t("deleteAccount")}
            </Button>
          ) : (
            // The server side is NIW2-214 / #268: until then the button is shown, disabled.
            <div {...stylex.props(s.soon)}>
              <Button variant="dangerOutline" disabled>
                {t("deleteAccount")}
              </Button>
              <Tag>{t("deleteComingSoon")}</Tag>
            </div>
          )}
        </div>
      )}

      <Dialog open={open} title={t("deleteDialogTitle")} onClose={close}>
        <form onSubmit={(e) => void confirm(e)} noValidate>
          <p {...stylex.props(s.intro)}>{t("deleteDialogIntro")}</p>
          <ul {...stylex.props(s.list)}>
            <li>{t("deletesProfile")}</li>
            <li>{t("deletesCloud")}</li>
            <li>{t("deletesSignIn")}</li>
          </ul>
          {impact && (
            <p {...stylex.props(s.impact)}>
              {t("deleteImpact", {
                cloudFiles: impact.cloudFiles,
                pendingUploads: impact.pendingUploads,
              })}
            </p>
          )}
          <p {...stylex.props(s.kept)}>
            <Check size={15} strokeWidth={2.4} aria-hidden {...stylex.props(s.keptIcon)} />
            {t("deleteLocalKept")}
          </p>
          <p {...stylex.props(s.grace)}>{t("deleteGrace")}</p>

          <Field
            id="delete-email"
            label={t("deleteTypeEmail", { email })}
            value={typedEmail}
            onChange={(e) => setTypedEmail(e.target.value)}
            autoComplete="off"
            placeholder={t("deleteEmailLabel")}
          />
          {hasPassword && (
            <Field
              id="delete-password"
              label={t("deletePasswordLabel")}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              error={failure === "wrong-password" ? t("deleteWrongPassword") : null}
            />
          )}

          {failure === "session-not-fresh" && (
            <p role="alert" {...stylex.props(s.error)}>
              {t("deleteNotFresh")}{" "}
              <a href={SIGN_IN_AGAIN} {...stylex.props(s.errorLink)}>
                {t("deleteSignInAgain")}
              </a>
            </p>
          )}
          {failure === "failed" && (
            <p role="alert" {...stylex.props(s.error)}>
              {t("deleteFailed")}
            </p>
          )}

          <div {...stylex.props(s.actions)}>
            <Button onClick={close}>{t("cancel")}</Button>
            <Button type="submit" variant="danger" disabled={!canConfirm}>
              {pending ? t("deleteWorking") : t("deleteConfirm")}
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}

const s = stylex.create({
  gap: { marginBottom: "12px" },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px" },
  description: {
    flex: "1",
    minWidth: "220px",
    margin: 0,
    fontSize: "14px",
    lineHeight: 1.5,
    color: kl.dim,
  },
  soon: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" },
  intro: { margin: 0, marginTop: "12px", fontSize: "14px", color: kl.dim },
  list: { margin: 0, marginTop: "6px", paddingLeft: "20px", fontSize: "14px", lineHeight: 1.6 },
  impact: {
    margin: 0,
    marginTop: "14px",
    paddingBlock: "11px",
    paddingInline: "13px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(239, 68, 68, 0.3)",
    borderRadius: "10px",
    backgroundColor: tone.redSoft,
    fontSize: "13.5px",
    color: kl.tx,
  },
  kept: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    margin: 0,
    marginTop: "10px",
    fontSize: "13.5px",
    color: kl.dim,
  },
  keptIcon: { flexShrink: 0, color: tone.green },
  grace: {
    margin: 0,
    marginTop: "8px",
    marginBottom: "16px",
    fontSize: "13px",
    lineHeight: 1.5,
    color: kl.faint,
  },
  error: { margin: 0, marginBottom: "12px", fontSize: "13px", lineHeight: 1.45, color: tone.red },
  errorBelow: { marginTop: "10px", marginBottom: 0 },
  errorLink: { color: tone.red, textDecoration: "underline" },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "20px",
  },
});
