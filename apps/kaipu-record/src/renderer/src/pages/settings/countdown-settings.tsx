import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { Row } from "@kaipu/ui";
import { Button } from "@kaipu/ui";
import {
  DEFAULT_RECORDING_COUNTDOWN_SECONDS,
  RECORDING_COUNTDOWN_OPTIONS,
  sanitizeCountdownSeconds,
} from "@shared/types";
import { useAppSettings } from "./use-app-settings";

/**
 * Length of the countdown before a take (off, 3 or 5 seconds) — writes
 * AppSettings.recordingCountdownSeconds. The recorder reads it when a start is requested, so
 * the choice applies to the next recording without a restart.
 */
export function CountdownSettings(): React.JSX.Element {
  const t = useTranslations("settings");
  const { settings, update } = useAppSettings();
  const current = sanitizeCountdownSeconds(
    settings?.recordingCountdownSeconds ?? DEFAULT_RECORDING_COUNTDOWN_SECONDS,
  );

  return (
    <Row
      label={t("countdown")}
      description={t("countdownDescription")}
      action={
        <div role="radiogroup" aria-label={t("countdown")} style={{ display: "flex", gap: 8 }}>
          {RECORDING_COUNTDOWN_OPTIONS.map((seconds) => (
            <Button
              key={seconds}
              size="sm"
              role="radio"
              aria-checked={current === seconds}
              variant={current === seconds ? "primary" : "outline"}
              onClick={() => void update({ recordingCountdownSeconds: seconds })}
            >
              {seconds === 0 ? t("countdownOff") : t("countdownSeconds", { seconds })}
            </Button>
          ))}
        </div>
      }
    />
  );
}
