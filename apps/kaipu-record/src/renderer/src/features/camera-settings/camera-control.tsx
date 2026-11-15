import React, { type RefObject } from "react";
import { CameraSetupCard } from "./camera-setup-card";
import { CameraToggleSplit } from "./camera-toggle-split";
import type { SettingsDrawerVariant } from "../settings-controls/settings-drawer";
import { CameraSettingsDrawer } from "./camera-settings-drawer";
import { useSettingsDisclosure } from "../settings-controls/use-settings-disclosure";
import { useCameraSettings, type CameraSettingsStore } from "./use-camera-settings";
import type { UiAreaProps } from "@renderer/lib/ui-area";

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
 * full-size on the Record page (`compact={false}`). `card` is the Capture page's setup card:
 * name, camera · shape, size, a switch and a chevron.
 */
export function CameraPanelTile({
  control,
  on,
  onToggle,
  compact = true,
  card = false,
  ui,
}: Omit<CameraControlProps, "isRecording"> & {
  control: CameraControl;
  compact?: boolean;
  card?: boolean;
  ui?: UiAreaProps;
}): React.JSX.Element {
  if (card) {
    return (
      <CameraSetupCard
        bubble={control.store.bubble}
        cameras={control.store.cameras}
        on={on}
        onToggle={onToggle}
        blocked={control.blocked}
        open={control.open}
        onOpenChange={control.setOpen}
        controlsId={control.settingsId}
        chevronRef={control.chevronRef}
        ui={ui}
      />
    );
  }
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
      ui={ui}
    />
  );
}

export function CameraPanelDrawer({
  control,
  on,
  isRecording,
  variant = "panel",
  ui,
}: Omit<CameraControlProps, "onToggle"> & {
  control: CameraControl;
  variant?: SettingsDrawerVariant;
  ui?: UiAreaProps;
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
      ui={ui}
    />
  );
}
