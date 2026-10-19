import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { client } from "@/lib/orpc-client";
import { Notice, buttonProps, quietLinkProps } from "./ui";

/**
 * Q3: the one-time banner after the pre-hijack guard removed a password that was set before the
 * email was verified. The API clears the notice as it answers, so a later answer is always
 * "nothing": the banner only ever turns on (until dismissed), and a failed ask just shows nothing.
 */
export function CredentialDroppedNotice() {
  const t = useTranslations("dashboard");
  const [show, setShow] = useState(false);

  useEffect(() => {
    // No "ignore after unmount" guard on purpose: under StrictMode the effect runs twice, the
    // first call consumes the notice, and dropping its answer would lose the banner for good.
    client.me
      .takeNotices()
      .then((response) => {
        if (response.data?.credentialDropped) setShow(true);
      })
      .catch(() => {
        // Best effort: a missed banner is not worth an error on the dashboard.
      });
  }, []);

  if (!show) return null;

  return (
    <Notice
      icon={<KeyRound size={18} />}
      title={t("credentialDroppedTitle")}
      detail={t("credentialDroppedDetail")}
      actions={
        <>
          <Link to="/dashboard/profile" {...buttonProps({ size: "sm" })}>
            {t("credentialDroppedAction")}
          </Link>
          <button type="button" onClick={() => setShow(false)} {...quietLinkProps()}>
            {t("credentialDroppedDismiss")}
          </button>
        </>
      }
    />
  );
}
