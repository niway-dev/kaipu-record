import React, { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { Camera } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { CameraBlockedCard, CameraSettingsFields } from "./camera-settings-fields";
import type { CameraSettingsStore } from "./use-camera-settings";
import styles from "./camera-settings-content.module.css";

export interface CameraSettingsContentProps {
  store: CameraSettingsStore;
  cameraOn: boolean;
  isRecording: boolean;
  compact?: boolean;
}

/**
 * The focus contract both containers (popover and drawer) share: opening moves focus into
 * the content (the Shape group, or the blocked card's button), Esc closes and gives focus
 * back to the chevron.
 */
export function useSettingsFocus(
  open: boolean,
  chevronRef: RefObject<HTMLButtonElement | null>,
  onClose: () => void,
): {
  firstRef: RefObject<HTMLElement | null>;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
} {
  const firstRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const target = firstRef.current;
    if (!target) return;
    // Into the group: its checked radio is its tab stop.
    const radio = target.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
    (radio ?? target).focus();
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
    chevronRef.current?.focus();
  };

  return { firstRef, onKeyDown };
}

/** Header + settings, or the blocked card while camera access is denied. */
export function CameraSettingsContent({
  store,
  cameraOn,
  isRecording,
  compact = false,
  firstRef,
}: CameraSettingsContentProps & {
  firstRef: RefObject<HTMLElement | null>;
}): React.JSX.Element {
  const t = useTranslations("cameraSettings");
  const blocked = store.access === "blocked";
  return (
    <div className={styles.content} data-compact={compact || undefined}>
      <div className={styles.header}>
        <Camera size={compact ? 13 : 15} aria-hidden className={styles.headerIcon} />
        <span className={styles.headerTitle}>{t("camera")}</span>
      </div>
      {blocked ? (
        <CameraBlockedCard
          compact={compact}
          onOpenSystemSettings={store.openSystemSettings}
          buttonRef={firstRef as RefObject<HTMLButtonElement | null>}
        />
      ) : (
        <CameraSettingsFields
          bubble={store.bubble}
          onChange={store.update}
          cameras={store.cameras}
          cameraOn={cameraOn}
          isRecording={isRecording}
          compact={compact}
          shapeRef={firstRef as RefObject<HTMLDivElement | null>}
        />
      )}
    </div>
  );
}
