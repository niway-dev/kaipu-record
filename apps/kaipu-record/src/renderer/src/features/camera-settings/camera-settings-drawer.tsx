import React, { type RefObject } from "react";
import { useTranslations } from "@kaipu/i18n";
import { SettingsDrawer } from "../settings-controls/settings-drawer";
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
}

/** The capture panel's camera settings, as an inline drawer under the row. */
export function CameraSettingsDrawer({
  id,
  open,
  onClose,
  chevronRef,
  store,
  cameraOn,
  isRecording,
}: CameraSettingsDrawerProps): React.JSX.Element | null {
  const t = useTranslations("cameraSettings");
  const { firstRef, onKeyDown } = useSettingsFocus(open, chevronRef, onClose);
  return (
    <SettingsDrawer id={id} label={t("title")} open={open} onKeyDown={onKeyDown}>
      <CameraSettingsContent
        store={store}
        cameraOn={cameraOn}
        isRecording={isRecording}
        compact
        firstRef={firstRef}
      />
    </SettingsDrawer>
  );
}
