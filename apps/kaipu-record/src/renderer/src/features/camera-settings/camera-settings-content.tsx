import React, { type RefObject } from "react";
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
