import React, { type RefObject } from "react";
import { CameraToggleSplit } from "./camera-toggle-split";
import { CameraSettingsPopover } from "./camera-settings-popover";
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

/** State the split tile and its settings (popover or drawer) share. */
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
 * The Record page's Camera tile: the split toggle and its popover, self-contained so the
 * page swaps it in for the plain tile (`RecordingToggles`' `cameraSlot`) and nothing else.
 * The popover is `fixed`, so rendering it inside the row does not change the row's layout.
 */
export function CameraControlWithPopover({
  on,
  onToggle,
  isRecording,
}: CameraControlProps): React.JSX.Element {
  const control = useCameraControl();
  return (
    <>
      <CameraToggleSplit
        on={on}
        onToggle={onToggle}
        blocked={control.blocked}
        open={control.open}
        onOpenChange={control.setOpen}
        controlsId={control.settingsId}
        chevronRef={control.chevronRef}
      />
      <CameraSettingsPopover
        id={control.settingsId}
        open={control.open}
        onClose={control.close}
        chevronRef={control.chevronRef}
        store={control.store}
        cameraOn={on}
        isRecording={isRecording}
      />
    </>
  );
}

/**
 * The capture panel's two pieces: the compact split tile goes in the row, the drawer right
 * under the row (in the panel's flow, so the panel grows). They share `control`.
 */
export function CameraPanelTile({
  control,
  on,
  onToggle,
}: Omit<CameraControlProps, "isRecording"> & { control: CameraControl }): React.JSX.Element {
  return (
    <CameraToggleSplit
      compact
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
}: Omit<CameraControlProps, "onToggle"> & { control: CameraControl }): React.JSX.Element | null {
  return (
    <CameraSettingsDrawer
      id={control.settingsId}
      open={control.open}
      onClose={control.close}
      chevronRef={control.chevronRef}
      store={control.store}
      cameraOn={on}
      isRecording={isRecording}
    />
  );
}
