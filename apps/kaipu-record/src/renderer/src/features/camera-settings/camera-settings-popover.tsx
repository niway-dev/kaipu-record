import React, { type RefObject } from "react";
import { useTranslations } from "@kaipu/i18n";
import { SettingsPopover } from "../settings-controls/settings-popover";
import { useSettingsFocus } from "../settings-controls/use-settings-focus";
import { CameraSettingsContent } from "./camera-settings-content";
import type { CameraSettingsStore } from "./use-camera-settings";

export interface CameraSettingsPopoverProps {
  id: string;
  open: boolean;
  onClose: () => void;
  /** The chevron: the popover hangs under its row, right-aligned with it. */
  chevronRef: RefObject<HTMLButtonElement | null>;
  store: CameraSettingsStore;
  cameraOn: boolean;
  isRecording: boolean;
}

/** The Record page's camera settings: a 272 px popover, right-aligned with the chevron. */
export function CameraSettingsPopover({
  id,
  open,
  onClose,
  chevronRef,
  store,
  cameraOn,
  isRecording,
}: CameraSettingsPopoverProps): React.JSX.Element | null {
  const t = useTranslations("cameraSettings");
  const { firstRef, onKeyDown } = useSettingsFocus(open, chevronRef, onClose);
  return (
    <SettingsPopover
      id={id}
      label={t("title")}
      open={open}
      onClose={onClose}
      chevronRef={chevronRef}
      align="end"
      width={272}
      onKeyDown={onKeyDown}
    >
      <CameraSettingsContent
        store={store}
        cameraOn={cameraOn}
        isRecording={isRecording}
        firstRef={firstRef}
      />
    </SettingsPopover>
  );
}
