import React, { type RefObject } from "react";
import {
  CameraPanelPopover,
  type CameraControl,
} from "@renderer/features/camera-settings/camera-control";
import { useCameraSettings } from "@renderer/features/camera-settings/use-camera-settings";
import {
  MicPanelPopover,
  type AudioControl,
} from "@renderer/features/audio-settings/audio-controls";
import { useAudioSettings } from "@renderer/features/audio-settings/use-audio-settings";
import { uiArea } from "@renderer/lib/ui-area";
import type { WidgetDevices } from "./use-widget-devices";

/** What an input cell hands its popover: the id its chevron points at, and how to close it. */
export interface WidgetPopoverProps {
  id: string;
  /** The cell's chevron: focus returns there when the popover closes. */
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  /** The input's toggle, as the overlay holds it. */
  on: boolean;
}

/**
 * The Microphone popover of the widget: the Capture page's panel (device list, input level,
 * noise suppression) over the overlay's microphone choice. Mounted only while open, so the
 * audio store and the pre-take level meter (it opens the device) exist exactly that long.
 */
export function WidgetMicPopover({
  id,
  anchorRef,
  onClose,
  on,
  devices,
}: WidgetPopoverProps & { devices: WidgetDevices | undefined }): React.JSX.Element {
  const store = useAudioSettings();
  const control: AudioControl = {
    open: true,
    setOpen: (open) => {
      if (!open) onClose();
    },
    close: onClose,
    chevronRef: anchorRef,
    settingsId: id,
    store,
  };
  const microphones = devices?.microphones ?? [];
  return (
    <MicPanelPopover
      ui={uiArea("captureOverlay.micPopover")}
      control={control}
      on={on}
      isRecording={false}
      microphones={microphones}
      selectedMicrophone={
        microphones.find((microphone) => microphone.deviceId === devices?.microphoneId) ?? null
      }
      onSelectMicrophone={(microphone) => devices?.selectMicrophone(microphone.deviceId)}
    />
  );
}

/**
 * The Camera popover of the widget: the camera list, Mirror my video and Framing, or the blocked
 * card, written to the camera bubble settings. Mounted only while open, so the camera list and
 * the access check are read exactly that long.
 */
export function WidgetCameraPopover({
  id,
  anchorRef,
  onClose,
  on,
}: WidgetPopoverProps): React.JSX.Element {
  const store = useCameraSettings();
  const control: CameraControl = {
    store,
    open: true,
    setOpen: (open) => {
      if (!open) onClose();
    },
    close: onClose,
    chevronRef: anchorRef,
    settingsId: id,
    blocked: store.access === "blocked",
  };
  return (
    <CameraPanelPopover
      ui={uiArea("captureOverlay.cameraPopover")}
      control={control}
      on={on}
      isRecording={false}
    />
  );
}
