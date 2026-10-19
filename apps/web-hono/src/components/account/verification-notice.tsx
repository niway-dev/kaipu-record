import { useEffect, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import * as stylex from "@stylexjs/stylex";
import { Lock, Mail, RefreshCw } from "lucide-react";
import { authClient } from "@/lib/auth/auth-client";
import {
  cooldownRemainingMs,
  readResendSentAt,
  withinResendCooldown,
  writeResendSentAt,
} from "@/lib/resend-cooldown";
import { tone } from "../dashboard/dashboard.stylex";
import { Button, Notice } from "@/components/dashboard/ui";

type ResendStatus = "idle" | "pending" | "failed";

/**
 * "Cloud is locked until you verify your email" with the resend action and its two-minute
 * cooldown. Shared by the profile page and the dashboard home: the cooldown is remembered per
 * user in this browser, so both surfaces agree. Render it only for an unverified user.
 */
export function VerificationNotice({
  user,
  onSessionChanged,
}: {
  user: { id: string; email: string };
  /** Re-reads everything that came from the session (header, badge, storage). */
  onSessionChanged: () => Promise<void>;
}) {
  const t = useTranslations("account");

  // Read after mount: the server render has no localStorage, and reading it during render would
  // make the first client render disagree with the markup.
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [resend, setResend] = useState<ResendStatus>("idle");
  const [refreshFailed, setRefreshFailed] = useState(false);

  useEffect(() => {
    setSentAt(readResendSentAt(user.id));
    setNow(Date.now());
  }, [user.id]);

  // Re-enable the resend button when the cooldown ends, without polling every second.
  useEffect(() => {
    const remaining = cooldownRemainingMs(sentAt, now);
    if (remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), remaining + 50);
    return () => clearTimeout(timer);
  }, [sentAt, now]);

  async function resendVerification() {
    setResend("pending");
    const result = await authClient.sendVerificationEmail({
      email: user.email,
      callbackURL: "/auth/email-verified",
    });
    if (result.error) {
      // A failure leaves the button usable: it must not look like a send that never happened.
      setResend("failed");
      return;
    }
    const sent = Date.now();
    writeResendSentAt(user.id, sent);
    setSentAt(sent);
    setNow(sent);
    setResend("idle");
  }

  async function refresh() {
    setRefreshFailed(false);
    try {
      // The session cookie is cached for ten minutes; without this the badge would keep saying
      // "not verified" after the user clicked the link in another tab.
      await authClient.getSession({ query: { disableCookieCache: true } });
      await onSessionChanged();
    } catch {
      setRefreshFailed(true);
    }
  }

  const coolingDown = withinResendCooldown(sentAt, now);
  const justSent = sentAt !== null && resend !== "failed";

  // Refreshing only makes sense once a mail is out: before that there is nothing for the server
  // to have recorded.
  const refreshButton =
    sentAt !== null ? (
      <Button size="sm" icon={<RefreshCw size={15} aria-hidden />} onClick={() => void refresh()}>
        {t("refresh")}
      </Button>
    ) : null;

  return (
    <div {...stylex.props(s.stack)}>
      <Notice
        tone={resend === "failed" ? "danger" : "pink"}
        icon={justSent ? <Mail size={18} /> : <Lock size={18} />}
        title={justSent ? t("resendSentTitle") : t("unverifiedTitle")}
        detail={
          resend === "failed"
            ? t("resendFailed")
            : justSent
              ? t("resendSentDetail")
              : t("unverifiedDetail")
        }
        actions={
          <>
            <Button
              variant={justSent ? "outline" : "pink"}
              size="sm"
              wrap
              onClick={() => void resendVerification()}
              disabled={resend === "pending" || coolingDown}
            >
              {t("resendVerification")}
            </Button>
            {refreshButton}
          </>
        }
      />
      {refreshFailed && (
        <p role="alert" {...stylex.props(s.error)}>
          {t("refreshFailed")}
        </p>
      )}
    </div>
  );
}

const s = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: "8px" },
  error: { margin: 0, fontSize: "13px", color: tone.red },
});
