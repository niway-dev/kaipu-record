import React, { type RefObject } from "react";
import { useTranslations } from "@kaipu/i18n";
import { CameraSettingsContent, useSettingsFocus } from "./camera-settings-content";
import type { CameraSettingsStore } from "./use-camera-settings";
import styles from "./camera-settings-drawer.module.css";

export interface CameraSettingsDrawerProps {
  id: string;
  open: boolean;
  onClose: () => void;
  chevronRef: RefObject<HTMLButtonElement | null>;
  store: CameraSettingsStore;
  cameraOn: boolean;
  isRecording: boolean;
}

/**
 * The capture panel's camera settings. The panel hides when it loses focus, so a popover
 * (a second layer, or a second window) is out: the chevron expands this drawer inline,
 * the panel grows downward (its ResizeObserver resizes the window) and focus never leaves
 * the window. Esc or the chevron closes it.
 */
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
  if (!open) return null;
  return (
    <div
      id={id}
      role="region"
      aria-label={t("title")}
      className={styles.drawer}
      onKeyDown={onKeyDown}
    >
      <CameraSettingsContent
        store={store}
        cameraOn={cameraOn}
        isRecording={isRecording}
        compact
        firstRef={firstRef}
      />
    </div>
  );
}
