import React from "react";
import { Lock, Monitor } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { SourceCard as SourceCardView } from "@kaipu/ui";
import type { SelectedSource } from "@renderer/features/recording/types";

interface SourceCardProps {
  source: SelectedSource | null;
  variant?: "full" | "compact";
  /** While recording the source can't change — show a LOCKED badge, not Change. */
  locked?: boolean;
  onChoose: () => void;
}

/** Dumb selected-source summary + choose/change action (or a LOCKED badge).
 *  This wrapper turns a `SelectedSource` into the words and icons the view shows. */
export function SourceCard({
  source,
  variant = "full",
  locked = false,
  onChoose,
}: SourceCardProps): React.JSX.Element {
  const t = useTranslations("record");
  const compact = variant === "compact";
  return (
    <SourceCardView
      variant={variant}
      icon={<Monitor size={compact ? 14 : 16} />}
      name={source?.name ?? t("noSource")}
      meta={
        source
          ? source.type === "screen"
            ? t("sourceScreen")
            : t("sourceWindow")
          : t("chooseSource")
      }
      actionLabel={source ? t("change") : t("choose")}
      onAction={onChoose}
      locked={locked}
      lockedIcon={<Lock size={11} />}
      lockedLabel={t("locked")}
    />
  );
}
