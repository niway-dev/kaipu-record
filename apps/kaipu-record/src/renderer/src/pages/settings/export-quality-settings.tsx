import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { EXPORT_QUALITIES, type ExportQuality } from "@shared/types";
import styles from "./recording-quality-settings.module.css";

export interface ExportQualitySettingsProps {
  quality: ExportQuality;
  onChange(quality: ExportQuality): void;
}

const LABEL = {
  balanced: "exportQualityBalanced",
  maximum: "exportQualityMaximum",
} as const satisfies Record<ExportQuality, string>;

const CAPTION = {
  balanced: "exportQualityBalancedCaption",
  maximum: "exportQualityMaximumCaption",
} as const satisfies Record<ExportQuality, string>;

/**
 * Settings → Export quality (NIW2-218): the row the export sheet preselects. The same chips
 * as Recording quality right above it, with two choices and no sliders — destination rows
 * (YouTube, GitHub, …) stay a per-export pick in the sheet.
 */
export function ExportQualitySettings({
  quality,
  onChange,
}: ExportQualitySettingsProps): React.JSX.Element {
  const t = useTranslations("settings");
  return (
    <div className={styles.quality}>
      <div className={styles.chips} role="radiogroup" aria-label={t("exportQualityGroup")}>
        {EXPORT_QUALITIES.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={quality === id}
            className={styles.chip}
            data-active={quality === id}
            onClick={() => onChange(id)}
          >
            {id === "balanced" && <span aria-hidden="true">⭐ </span>}
            {t(LABEL[id])}
          </button>
        ))}
      </div>
      <p className={styles.caption}>{t(CAPTION[quality])}</p>
      <p className={styles.caption}>{t("exportQualityNote")}</p>
    </div>
  );
}
