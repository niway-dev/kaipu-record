import React, { type Ref } from "react";
import { Camera, Lock } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { ToggleSplit } from "../settings-controls/toggle-split";

export interface CameraToggleSplitProps {
  on: boolean;
  onToggle: () => void;
  /** Camera access is denied: the tile reads BLOCKED and cannot turn the camera on. */
  blocked?: boolean;
  /** The capture panel's tile: no text label, a narrower chevron. */
  compact?: boolean;
  /** Whether the settings (popover or drawer) are open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The element the open settings belong to, for aria-controls. */
  controlsId?: string;
  /** The chevron, so the settings can send focus back to it when they close. */
  chevronRef?: Ref<HTMLButtonElement>;
}

/**
 * The Camera tile of the Mic · Audio · Camera row, split in two: the body toggles the
 * camera exactly as the plain tile did, and a chevron segment on its right opens the
 * camera settings.
 */
export function CameraToggleSplit({
  on,
  onToggle,
  blocked = false,
  ...rest
}: CameraToggleSplitProps): React.JSX.Element {
  const t = useTranslations("cameraSettings");
  const tStatus = useTranslations("record");
  return (
    <ToggleSplit
      {...rest}
      icon={Camera}
      blockedIcon={Lock}
      label={t("camera")}
      status={blocked ? t("blocked") : on ? tStatus("statusOn") : tStatus("statusOff")}
      on={on}
      onToggle={onToggle}
      blocked={blocked}
      // A blocked camera cannot be turned on; one that is somehow on can still be turned off.
      bodyDisabled={blocked && !on}
      bodyLabel={blocked ? t("blockedTile") : undefined}
      chevronLabel={t("title")}
    />
  );
}
