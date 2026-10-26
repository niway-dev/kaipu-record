import React, { type Ref } from "react";
import { Camera, ChevronDown, Lock } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import styles from "./camera-toggle-split.module.css";

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
 * camera settings. Someone who never touches the chevron sees the same row as before.
 */
export function CameraToggleSplit({
  on,
  onToggle,
  blocked = false,
  compact = false,
  open,
  onOpenChange,
  controlsId,
  chevronRef,
}: CameraToggleSplitProps): React.JSX.Element {
  const t = useTranslations("cameraSettings");
  const iconSize = compact ? 15 : 20;
  // A blocked camera cannot be turned on; one that is somehow on can still be turned off.
  const cannotToggle = blocked && !on;

  return (
    <div
      className={styles.split}
      data-compact={compact || undefined}
      data-active={on || undefined}
      data-blocked={blocked || undefined}
    >
      <button
        type="button"
        className={styles.body}
        aria-pressed={on}
        aria-disabled={cannotToggle || undefined}
        aria-label={blocked ? t("blockedTile") : undefined}
        onClick={cannotToggle ? undefined : onToggle}
      >
        <span className={styles.icon}>
          {blocked ? <Lock size={iconSize} /> : <Camera size={iconSize} />}
        </span>
        {!compact && <span className={styles.label}>{t("camera")}</span>}
        <span className={styles.status}>{blocked ? t("blocked") : on ? "ON" : "OFF"}</span>
      </button>
      <button
        ref={chevronRef}
        type="button"
        className={styles.chevron}
        aria-label={t("title")}
        // The popover is a dialog; the panel's drawer is an inline region.
        aria-haspopup={compact ? undefined : "dialog"}
        aria-expanded={open}
        aria-controls={open ? controlsId : undefined}
        data-open={open || undefined}
        onClick={() => onOpenChange(!open)}
      >
        <ChevronDown size={compact ? 12 : 14} aria-hidden />
      </button>
    </div>
  );
}
