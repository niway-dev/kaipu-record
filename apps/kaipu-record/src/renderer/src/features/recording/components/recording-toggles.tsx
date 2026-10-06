import React from "react";
import { Mic, Volume2, Camera } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { StatusToggleRow } from "@kaipu/ui";

interface RecordingTogglesProps {
  isMicrophoneEnabled: boolean;
  isSystemAudioEnabled: boolean;
  isCameraEnabled: boolean;
  /**
   * Mid-take, when the recording has no loopback track: the system-audio toggle
   * is disabled with an explanatory tooltip, since turning it on could not work.
   */
  isSystemAudioUnavailable?: boolean;
  variant?: "full" | "compact";
  onToggleMicrophone: () => void;
  onToggleSystemAudio: () => void;
  onToggleCamera: () => void;
}

/** Dumb mic/audio/camera toggles. The compact variant drops the text labels.
 *  This wrapper supplies the icons and the translated labels. */
export function RecordingToggles({
  isMicrophoneEnabled,
  isSystemAudioEnabled,
  isCameraEnabled,
  isSystemAudioUnavailable = false,
  variant = "full",
  onToggleMicrophone,
  onToggleSystemAudio,
  onToggleCamera,
}: RecordingTogglesProps): React.JSX.Element {
  const t = useTranslations("record");
  const iconSize = variant === "compact" ? 15 : 20;

  return (
    <StatusToggleRow
      variant={variant}
      items={[
        {
          id: "mic",
          icon: <Mic size={iconSize} />,
          label: t("micLabel"),
          isActive: isMicrophoneEnabled,
          onToggle: onToggleMicrophone,
        },
        {
          id: "audio",
          icon: <Volume2 size={iconSize} />,
          label: t("audioLabel"),
          isActive: isSystemAudioEnabled,
          onToggle: onToggleSystemAudio,
          disabled: isSystemAudioUnavailable,
          title: isSystemAudioUnavailable ? t("audioUnavailable") : undefined,
        },
        {
          id: "camera",
          icon: <Camera size={iconSize} />,
          label: t("cameraLabel"),
          isActive: isCameraEnabled,
          onToggle: onToggleCamera,
        },
      ]}
    />
  );
}
