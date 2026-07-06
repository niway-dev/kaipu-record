import React from "react";
import { Lock, Monitor } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { SelectedSource } from "@renderer/features/recording/types";
import { cx } from "@renderer/ui/cx";
import styles from "./source-card.module.css";

interface SourceCardProps {
  source: SelectedSource | null;
  variant?: "full" | "compact";
  /** While recording the source can't change — show a LOCKED badge, not Change. */
  locked?: boolean;
  onChoose: () => void;
}

/** Dumb selected-source summary + choose/change action (or a LOCKED badge). */
export function SourceCard({
  source,
  variant = "full",
  locked = false,
  onChoose,
}: SourceCardProps): React.JSX.Element {
  const t = useTranslations("record");
  const compact = variant === "compact";
  return (
    <div className={cx(styles.card, compact && styles.compact)}>
      <Monitor size={compact ? 14 : 16} className={styles.icon} />
      <div className={styles.info}>
        <span className={styles.name}>{source?.name ?? t("noSource")}</span>
        <span className={styles.meta}>
          {source
            ? source.type === "screen"
              ? t("sourceScreen")
              : t("sourceWindow")
            : t("chooseSource")}
        </span>
      </div>
      {locked ? (
        <span className={styles.locked}>
          <Lock size={11} />
          {t("locked")}
        </span>
      ) : (
        <button type="button" className={styles.button} onClick={onChoose}>
          {source ? t("change") : t("choose")}
        </button>
      )}
    </div>
  );
}
