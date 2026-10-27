import React, { type RefObject } from "react";
import { useTranslations } from "@kaipu/i18n";
import { SettingsDrawer, type SettingsDrawerVariant } from "../settings-controls/settings-drawer";
import { useSettingsFocus } from "../settings-controls/use-settings-focus";
import { CameraSettingsContent } from "./camera-settings-content";
import type { CameraSettingsStore } from "./use-camera-settings";

export interface CameraSettingsDrawerProps {
  id: string;
  open: boolean;
  onClose: () => void;
  chevronRef: RefObject<HTMLButtonElement | null>;
  store: CameraSettingsStore;
  cameraOn: boolean;
  isRecording: boolean;
  variant?: SettingsDrawerVariant;
}

/** The camera settings, as an inline drawer under the row (capture panel and Record page). */
export function CameraSettingsDrawer({
  id,
  open,
  onClose,
  chevronRef,
  store,
  cameraOn,
  isRecording,
  variant = "panel",
}: CameraSettingsDrawerProps): React.JSX.Element | null {
  const t = useTranslations("cameraSettings");
  const { firstRef, onKeyDown } = useSettingsFocus(open, chevronRef, onClose);
  return (
    <SettingsDrawer id={id} label={t("title")} open={open} variant={variant} onKeyDown={onKeyDown}>
      <CameraSettingsContent
        store={store}
        cameraOn={cameraOn}
        isRecording={isRecording}
        compact={variant === "panel"}
        firstRef={firstRef}
      />
    </SettingsDrawer>
  );
}
