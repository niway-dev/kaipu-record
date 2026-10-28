import React, { type RefObject } from "react";
import { Volume1, Volume2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  SYSTEM_AUDIO_VOLUME_MAX,
  SYSTEM_AUDIO_VOLUME_MIN,
  type AudioSettings,
} from "@shared/audio-settings";
import { RadioChips } from "@renderer/features/camera-settings/camera-settings-fields";
import { LevelSlider, SwitchRow } from "./audio-settings-fields";
import styles from "./audio-settings-content.module.css";

export interface SystemAudioSettingsContentProps {
  audio: AudioSettings;
  onChange: (patch: Partial<AudioSettings>) => void;
  /** Ducking lowers the system audio under the user's voice: no mic, no voice. */
  micOn: boolean;
  compact?: boolean;
  /** The Record page's wide layout: what to capture on the left, volume on the right. */
  columns?: boolean;
  /** The capture group, which takes focus when the settings open. */
  firstRef: RefObject<HTMLElement | null>;
}

type CaptureChoice = "all" | "app";

/** The system-audio settings, shared by the Record page's drawer and the panel's drawer. */
export function SystemAudioSettingsContent({
  audio,
  onChange,
  micOn,
  compact = false,
  columns = false,
  firstRef,
}: SystemAudioSettingsContentProps): React.JSX.Element {
  const t = useTranslations("systemAudioSettings");
  const reason = t("notAvailableYet");
  const choices = [
    { value: "all" as const, text: t("allSound") },
    {
      value: "app" as const,
      text: t("oneApp"),
      // Electron's loopback captures the whole mix; per-app capture needs native work.
      disabled: true,
      ariaLabel: `${t("oneApp")}, ${reason}`,
      title: reason,
    },
  ];

  return (
    <div
      className={styles.content}
      data-compact={compact || undefined}
      data-columns={columns || undefined}
    >
      <div className={styles.header}>
        <Volume2 size={compact ? 13 : 15} aria-hidden className={styles.headerIcon} />
        <span className={styles.headerTitle}>{t("systemAudio")}</span>
      </div>

      <div className={styles.column}>
        <span className={styles.label} aria-hidden>
          {t("whatToCapture")}
        </span>
        <RadioChips<CaptureChoice>
          label={t("whatToCapture")}
          options={choices}
          value="all"
          onChange={() => {}}
          compact={compact}
          groupRef={firstRef as RefObject<HTMLDivElement | null>}
        />
        {/* The disabled chip already says it in its tooltip; the panel has no room twice. */}
        {!compact && (
          <p className={styles.hint} aria-hidden>
            {t("oneApp")} · {reason}
          </p>
        )}
      </div>

      <div className={styles.column}>
        <span className={styles.label} aria-hidden>
          {t("volume")}
        </span>
        <LevelSlider
          label={t("volume")}
          value={audio.systemAudioVolume}
          min={SYSTEM_AUDIO_VOLUME_MIN}
          max={SYSTEM_AUDIO_VOLUME_MAX}
          valueText={t("volumeValue", { percent: audio.systemAudioVolume })}
          icon={<Volume1 size={14} />}
          onChange={(systemAudioVolume) => onChange({ systemAudioVolume })}
        />

        <SwitchRow
          title={t("duckTitle")}
          hint={t("duckHint")}
          hintHidden={compact}
          checked={audio.duckSystemAudioWhileTalking}
          onChange={(duckSystemAudioWhileTalking) => onChange({ duckSystemAudioWhileTalking })}
          disabled={!micOn}
          disabledReason={t("duckNeedsMic")}
        />
      </div>
    </div>
  );
}
