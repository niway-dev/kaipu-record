import React, { type Ref } from "react";
import { Camera, Lock } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { CameraBubbleSettings } from "@shared/camera-bubble";
import { SetupCard } from "../settings-controls/setup-card";
import type { CameraDevice } from "./use-camera-settings";
import type { UiAreaProps } from "@renderer/lib/ui-area";

export interface CameraSetupCardProps {
  bubble: CameraBubbleSettings;
  cameras: CameraDevice[];
  on: boolean;
  onToggle: () => void;
  /** Camera access is denied: the card reads BLOCKED and cannot turn the camera on. */
  blocked?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controlsId?: string;
  chevronRef?: Ref<HTMLButtonElement>;
  ui?: UiAreaProps;
}

/**
 * The Camera card of the Capture page's setup row. Its secondary line is the chosen camera.
 * The bubble's shape and size are not shown: the camera records as its own video and those
 * are an editor decision.
 */
export function CameraSetupCard({
  bubble,
  cameras,
  on,
  onToggle,
  blocked = false,
  ...rest
}: CameraSetupCardProps): React.JSX.Element {
  const t = useTranslations("cameraSettings");
  const tStatus = useTranslations("record");

  const index = cameras.findIndex((camera) => camera.deviceId === bubble.deviceId);
  // Same names the camera list shows: unnamed devices by ordinal, an unplugged one after them.
  const camera =
    bubble.deviceId === null
      ? t("deviceDefault")
      : index >= 0
        ? cameras[index]!.label || t("deviceUnnamed", { index: index + 1 })
        : t("deviceUnnamed", { index: cameras.length + 1 });

  return (
    <SetupCard
      {...rest}
      icon={Camera}
      blockedIcon={Lock}
      name={t("camera")}
      detail={camera}
      status={blocked ? t("blocked") : on ? tStatus("statusOn") : tStatus("statusOff")}
      on={on}
      onToggle={onToggle}
      blocked={blocked}
      // A blocked camera cannot be turned on; one that is somehow on can still be turned off.
      switchDisabled={blocked && !on}
      switchLabel={blocked ? t("blockedTile") : undefined}
      chevronLabel={t("title")}
    />
  );
}
