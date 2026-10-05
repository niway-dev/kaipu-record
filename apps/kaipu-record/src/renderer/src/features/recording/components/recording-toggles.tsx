import React from "react";
import { Mic, Volume2, Camera } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { StatusToggleRow } from "@kaipu/ui";

interface RecordingTogglesProps {
  isMicrophoneEnabled: boolean;
  isSystemAudioEnabled: boolean;
  isCameraEnabled: boolean;
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
