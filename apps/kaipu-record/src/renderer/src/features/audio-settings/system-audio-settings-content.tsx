import React from "react";
import { Volume1 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  SYSTEM_AUDIO_VOLUME_MAX,
  SYSTEM_AUDIO_VOLUME_MIN,
  type AudioSettings,
} from "@shared/audio-settings";
import { LevelSlider, SwitchRow } from "./audio-settings-fields";
import styles from "./audio-settings-content.module.css";

export interface SystemAudioSettingsContentProps {
  audio: AudioSettings;
  onChange: (patch: Partial<AudioSettings>) => void;
  /** Ducking lowers the system audio under the user's voice: no mic, no voice. */
  micOn: boolean;
}

/**
 * The system-audio popover's content: the volume in the recording and ducking. What to
 * capture is not offered: Electron's loopback captures the whole mix, and the card already
 * says "All sound".
 */
export function SystemAudioSettingsContent({
  audio,
  onChange,
  micOn,
}: SystemAudioSettingsContentProps): React.JSX.Element {
  const t = useTranslations("systemAudioSettings");
  return (
    <div className={styles.content}>
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
        hintHidden
        checked={audio.duckSystemAudioWhileTalking}
        onChange={(duckSystemAudioWhileTalking) => onChange({ duckSystemAudioWhileTalking })}
        disabled={!micOn}
        disabledReason={t("duckNeedsMic")}
      />
    </div>
  );
}
