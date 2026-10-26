import React, { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useTranslations } from "@kaipu/i18n";
import { CameraSettingsContent, useSettingsFocus } from "./camera-settings-content";
import type { CameraSettingsStore } from "./use-camera-settings";
import styles from "./camera-settings-popover.module.css";

export interface CameraSettingsPopoverProps {
  id: string;
  open: boolean;
  onClose: () => void;
  /** The chevron: the popover hangs under its row, right-aligned with it. */
  chevronRef: RefObject<HTMLButtonElement | null>;
  store: CameraSettingsStore;
  cameraOn: boolean;
  isRecording: boolean;
}

/**
 * The Record page's camera settings: a 272 px non-modal dialog anchored right under the
 * Mic · Audio · Camera row. `fixed` from the chevron's measured position, like the shared
 * Popover, so no ancestor's overflow clips it and the row's layout is untouched. Closes on
 * Esc (focus back to the chevron), the chevron, or a press outside.
 */
export function CameraSettingsPopover({
  id,
  open,
  onClose,
  chevronRef,
  store,
  cameraOn,
  isRecording,
}: CameraSettingsPopoverProps): React.JSX.Element | null {
  const t = useTranslations("cameraSettings");
  const dialogRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const { firstRef, onKeyDown } = useSettingsFocus(open, chevronRef, onClose);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = (): void => {
      const rect = chevronRef.current?.getBoundingClientRect();
      if (rect) setAnchor({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, chevronRef]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (dialogRef.current?.contains(target) || chevronRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [open, onClose, chevronRef]);

  if (!open) return null;
  return (
    <div
      ref={dialogRef}
      id={id}
      role="dialog"
      aria-label={t("title")}
      className={styles.popover}
      style={anchor ? { top: anchor.top, right: anchor.right } : undefined}
      onKeyDown={onKeyDown}
    >
      <CameraSettingsContent
        store={store}
        cameraOn={cameraOn}
        isRecording={isRecording}
        firstRef={firstRef}
      />
    </div>
  );
}
