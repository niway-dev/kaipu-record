import React from "react";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { useOptionalWorkspaces } from "./workspaces-context";
import styles from "./not-connected-notice.module.css";

/**
 * The NOT CONNECTED state (design "Kaipu Workspaces v2", section 1): the active workspace's
 * folder is gone (an unplugged drive). Captures are refused, never saved anywhere else
 * (ADR 0032, decision 8), and this says so where a capture would start.
 */
export function WorkspaceNotConnectedNotice(): React.JSX.Element | null {
  const t = useTranslations("workspaces");
  const active = useOptionalWorkspaces()?.active;
  if (!active || active.state !== "unavailable") return null;
  return (
    <div className={styles.notice} role="alert">
      <TriangleAlert size={18} className={styles.icon} />
      <div>
        <div className={styles.title}>{t("notConnectedTitle", { name: active.name })}</div>
        <div className={styles.body}>
          {t("notConnectedBody", { location: active.volume ?? active.path })}
        </div>
      </div>
    </div>
  );
}
