import { useEffect, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { Button } from "@kaipu/web-ui";
import { authClient } from "@/lib/auth/auth-client";
import {
  readResendSentAt,
  withinResendCooldown,
  writeResendSentAt,
  cooldownRemainingMs,
} from "@/lib/resend-cooldown";
import { Notice } from "./notice";

type ResendStatus = "idle" | "pending" | "failed";

/**
 * "Cloud is locked until you verify your email", with the resend and refresh actions. Shared by
 * the profile page and the dashboard home so the 2-minute cooldown is one piece of state per
 * browser, not one per page. Renders nothing for a verified user.
 */
export function VerificationNotice({
  user,
  onSessionChanged,
}: {
  user: { id: string; email: string; emailVerified: boolean };
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

  if (user.emailVerified) return null;

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

  return (
    <div className="space-y-3">
      <Notice
        title={t("unverifiedNotice")}
        detail={resend === "failed" ? t("resendFailed") : justSent ? t("resendSent") : undefined}
        tone={resend === "failed" ? "destructive" : "default"}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => void resendVerification()}
          disabled={resend === "pending" || coolingDown}
        >
          {t("resendVerification")}
        </Button>
        {/* Refreshing only makes sense once a mail is out: before that there is nothing
            for the server to have recorded. */}
        {sentAt !== null && (
          <Button variant="outline" onClick={() => void refresh()}>
            {t("refresh")}
          </Button>
        )}
      </div>
      {refreshFailed && (
        <p role="alert" className="text-destructive text-sm">
          {t("refreshFailed")}
        </p>
      )}
    </div>
  );
}
