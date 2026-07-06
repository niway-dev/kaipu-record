import React from "react";
import { Mic, Volume2, Camera } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { cx } from "@renderer/ui/cx";
import styles from "./recording-toggles.module.css";

interface RecordingToggleProps {
  icon: React.ReactNode;
  label?: string;
  isActive: boolean;
  onToggle: () => void;
}

function RecordingToggle({
  icon,
  label,
  isActive,
  onToggle,
}: RecordingToggleProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={styles.toggle}
      data-active={isActive || undefined}
    >
      <span className={styles.icon}>{icon}</span>
      {label && <span className={styles.label}>{label}</span>}
      <span className={styles.status}>{isActive ? "ON" : "OFF"}</span>
    </button>
  );
}

interface RecordingTogglesProps {
  isMicrophoneEnabled: boolean;
  isSystemAudioEnabled: boolean;
  isCameraEnabled: boolean;
  variant?: "full" | "compact";
  onToggleMicrophone: () => void;
  onToggleSystemAudio: () => void;
  onToggleCamera: () => void;
}

/** Dumb mic/audio/camera toggles. The compact variant drops the text labels. */
export function RecordingToggles({
  isMicrophoneEnabled,
  isSystemAudioEnabled,
  isCameraEnabled,
  variant = "full",
  onToggleMicrophone,
  onToggleSystemAudio,
  onToggleCamera,
}: RecordingTogglesProps): React.JSX.Element {
  const t = useTranslations("record");
  const compact = variant === "compact";
  const iconSize = compact ? 15 : 20;
  const labels = compact
    ? { mic: undefined, audio: undefined, camera: undefined }
    : { mic: t("micLabel"), audio: t("audioLabel"), camera: t("cameraLabel") };

  return (
    <div className={cx(styles.row, compact && styles.compact)}>
      <RecordingToggle
        icon={<Mic size={iconSize} />}
        label={labels.mic}
        isActive={isMicrophoneEnabled}
        onToggle={onToggleMicrophone}
      />
      <RecordingToggle
        icon={<Volume2 size={iconSize} />}
        label={labels.audio}
        isActive={isSystemAudioEnabled}
        onToggle={onToggleSystemAudio}
      />
      <RecordingToggle
        icon={<Camera size={iconSize} />}
        label={labels.camera}
        isActive={isCameraEnabled}
        onToggle={onToggleCamera}
      />
    </div>
  );
}
