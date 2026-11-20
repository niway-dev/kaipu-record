import React, { type RefObject } from "react";
import { useTranslations } from "@kaipu/i18n";
import { SettingsPopover } from "../settings-controls/settings-popover";
import { CameraBlockedCard, CameraSettingsFields } from "./camera-settings-fields";
import type { CameraSettingsStore } from "./use-camera-settings";
import type { UiAreaProps } from "@renderer/lib/ui-area";

export interface CameraPopoverProps {
  id: string;
  open: boolean;
  onClose: () => void;
  /** The chevron that opens it: focus returns there when it closes. */
  anchorRef: RefObject<HTMLElement | null>;
  store: CameraSettingsStore;
  cameraOn: boolean;
  isRecording: boolean;
  ui?: UiAreaProps;
}

/**
 * The camera settings as a popover on the Capture page's Camera card and on the capture widget's
 * Camera cell: the camera list, Mirror my video and Framing, or the blocked card while camera
 * access is denied.
 */
export function CameraPopover({
  id,
  open,
  onClose,
  anchorRef,
  store,
  cameraOn,
  isRecording,
  ui,
}: CameraPopoverProps): React.JSX.Element | null {
  const t = useTranslations("cameraSettings");
  return (
    <SettingsPopover
      id={id}
      label={t("title")}
      open={open}
      anchorRef={anchorRef}
      onClose={onClose}
      ui={ui}
    >
      {store.access === "blocked" ? (
        <CameraBlockedCard onOpenSystemSettings={store.openSystemSettings} />
      ) : (
        <CameraSettingsFields
          bubble={store.bubble}
          onChange={store.update}
          cameras={store.cameras}
          cameraOn={cameraOn}
          isRecording={isRecording}
        />
      )}
    </SettingsPopover>
  );
}
