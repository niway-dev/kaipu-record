import React, { type RefObject } from "react";
import { CameraToggleSplit } from "./camera-toggle-split";
import type { SettingsDrawerVariant } from "../settings-controls/settings-drawer";
import { CameraSettingsDrawer } from "./camera-settings-drawer";
import { useSettingsDisclosure } from "../settings-controls/use-settings-disclosure";
import { useCameraSettings, type CameraSettingsStore } from "./use-camera-settings";

export interface CameraControl {
  store: CameraSettingsStore;
  open: boolean;
  setOpen: (open: boolean) => void;
  close: () => void;
  chevronRef: RefObject<HTMLButtonElement | null>;
  settingsId: string;
  blocked: boolean;
}

/** State the split tile and its settings drawer share. */
export function useCameraControl(): CameraControl {
  const store = useCameraSettings();
  const disclosure = useSettingsDisclosure();
  return { store, ...disclosure, blocked: store.access === "blocked" };
}

interface CameraControlProps {
  on: boolean;
  onToggle: () => void;
  isRecording: boolean;
}

/**
 * The split tile goes in the row, the drawer right under the row (in the page's flow, so it
 * pushes the content). They share `control`. The tile is compact for the capture panel and
 * full-size on the Record page (`compact={false}`).
 */
export function CameraPanelTile({
  control,
  on,
  onToggle,
  compact = true,
}: Omit<CameraControlProps, "isRecording"> & {
  control: CameraControl;
  compact?: boolean;
}): React.JSX.Element {
  return (
    <CameraToggleSplit
      compact={compact}
      on={on}
      onToggle={onToggle}
      blocked={control.blocked}
      open={control.open}
      onOpenChange={control.setOpen}
      controlsId={control.settingsId}
      chevronRef={control.chevronRef}
    />
  );
}

export function CameraPanelDrawer({
  control,
  on,
  isRecording,
  variant = "panel",
}: Omit<CameraControlProps, "onToggle"> & {
  control: CameraControl;
  variant?: SettingsDrawerVariant;
}): React.JSX.Element | null {
  return (
    <CameraSettingsDrawer
      id={control.settingsId}
      open={control.open}
      onClose={control.close}
      chevronRef={control.chevronRef}
      store={control.store}
      cameraOn={on}
      isRecording={isRecording}
      variant={variant}
    />
  );
}
