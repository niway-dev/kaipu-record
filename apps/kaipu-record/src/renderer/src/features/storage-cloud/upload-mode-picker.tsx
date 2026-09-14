import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { UPLOAD_MODES, type UploadMode } from "@shared/types";
import { cx } from "@renderer/ui/cx";
import styles from "./storage-cloud-settings.module.css";

const COPY = {
  "local-only": { label: "modeLocalOnly", description: "modeLocalOnlyDescription" },
  manual: { label: "modeManual", description: "modeManualDescription" },
  automatic: { label: "modeAutomatic", description: "modeAutomaticDescription" },
} as const satisfies Record<UploadMode, { label: string; description: string }>;

export interface UploadModePickerProps {
  /** `null` while settings are still loading: nothing is checked, nothing is claimed. */
  mode: UploadMode | null;
  /** Cloud modes need an account; local-only never does. */
  cloudAvailable: boolean;
  onChange(mode: UploadMode): void;
}

/**
 * Three mutually exclusive save modes as one radio group (not three toggles). Without an
 * account the cloud options stay visible but disabled, with the reason, and local-only keeps
 * working. A cloud mode saved earlier stays checked while signed out — signing out does not
 * silently rewrite the user's preference.
 */
export function UploadModePicker({
  mode,
  cloudAvailable,
  onChange,
}: UploadModePickerProps): React.JSX.Element {
  const t = useTranslations("storageCloud");
  const name = React.useId();
  const cloudModeWaiting = !cloudAvailable && mode !== null && mode !== "local-only";

  return (
    <div className={styles.modeBlock}>
      <div role="radiogroup" aria-label={t("saveMode")} className={styles.modeList}>
        {UPLOAD_MODES.map((option) => {
          const disabled = option !== "local-only" && !cloudAvailable;
          const checked = mode === option;
          return (
            <label
              key={option}
              className={cx(styles.modeOption, checked && styles.modeOptionChecked)}
              data-disabled={disabled || undefined}
            >
              <input
                type="radio"
                name={name}
                value={option}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(option)}
                className={styles.modeRadio}
              />
              <span className={styles.modeText}>
                <span className={styles.modeLabel}>{t(COPY[option].label)}</span>
                <span className={styles.modeDescription}>{t(COPY[option].description)}</span>
              </span>
            </label>
          );
        })}
      </div>
      {!cloudAvailable && (
        <p className={styles.note} role="note">
          {cloudModeWaiting ? t("modeSignedOutSaved") : t("modeSignInRequired")}
        </p>
      )}
      {cloudAvailable && mode === "automatic" && (
        <p className={styles.note} role="note">
          {t("modeAutomaticNote")}
        </p>
      )}
      <p className={styles.footnote}>{t("modeFootnote")}</p>
    </div>
  );
}
