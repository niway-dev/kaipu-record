import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import styles from "./export-frame-card.module.css";

/**
 * The export frame tool's options (mock A5): what the frame is for, and the two ways out of
 * it. They sit in the side panel's Tool tab (NIW2-723), where the card used to float over the
 * stage. Both buttons are ordinary export frame edits, so each is
 * one undo step. It replaces the classic crop tool's "Crop / Reset" panel in canvas mode.
 */
export function ExportFrameCard({
  hasFrame,
  onFit,
  onRemove,
  onDone,
}: {
  /** An export frame is set: only then is there something to remove. */
  hasFrame: boolean;
  /** Set the frame to the content box. */
  onFit: () => void;
  /** Clear the frame: the export is the whole content box again. */
  onRemove: () => void;
  /** Leave the tool, keeping the frame (NIW2-759): the stage then shows only what it exports. */
  onDone: () => void;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  return (
    <div {...uiArea("editorImage.exportFrameCard")} className={styles.card}>
      <div className={styles.title}>{t("exportFrameTitle")}</div>
      <div className={styles.body}>{t("exportFrameBody")}</div>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={onFit}>
          {t("exportFrameFit")}
        </button>
        <button type="button" className={styles.button} disabled={!hasFrame} onClick={onRemove}>
          {t("exportFrameRemove")}
        </button>
        <button
          type="button"
          title={t("cropDoneTitle")}
          className={`${styles.button} ${styles.done}`}
          onClick={onDone}
        >
          {t("cropDone")}
        </button>
      </div>
    </div>
  );
}
