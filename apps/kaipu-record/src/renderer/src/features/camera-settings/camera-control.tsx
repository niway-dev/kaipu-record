import React, { type RefObject } from "react";
import { CameraSetupCard } from "./camera-setup-card";
import { CameraToggleSplit } from "./camera-toggle-split";
import { CameraPopover } from "./camera-popover";
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

/** State the split tile and its settings popover share. */
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
 * The split tile goes in the row; its settings open as a popover anchored to it. They share
 * `control`. The tile is compact for the capture panel and full-size on the Record page
 * (`compact={false}`). `card` is the Capture page's setup card: name, camera, a switch and a
 * chevron.
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

/** The camera popover, bound to the control its card (or the widget's cell) shares. */
export function CameraPanelPopover({
  control,
  on,
  isRecording,
  ui,
}: Omit<CameraControlProps, "onToggle"> & {
  control: CameraControl;
  ui?: UiAreaProps;
}): React.JSX.Element | null {
  return (
    <CameraPopover
      id={control.settingsId}
      open={control.open}
      onClose={control.close}
      anchorRef={control.chevronRef}
      store={control.store}
      cameraOn={on}
      isRecording={isRecording}
      ui={ui}
    />
  );
}
