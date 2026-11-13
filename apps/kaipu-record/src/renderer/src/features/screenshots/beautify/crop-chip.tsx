import React from "react";
import { Crop } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import styles from "./crop-chip.module.css";

/**
 * The "Cropped" chip (NIW2-759): above the top-left corner of a cropped image while the crop
 * tool is not active. It is only visible while the pointer is over the image (CSS, in
 * `beautified-frame.module.css`'s chip slot) and brings the crop tool back on click. Its
 * tooltip names the other ways back: the crop tool's key and a double-click on the image.
 */
export function CropChip({
  onEnter,
  zoom = 1,
}: {
  onEnter: () => void;
  /** The view's zoom: the chip undoes it so it keeps its screen size. */
  zoom?: number;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  return (
    <div
      {...uiArea("editorImage.cropChip")}
      className={styles.anchor}
      style={{ transform: `scale(${1 / (zoom || 1)})` }}
      // A double-click on the chip is a click on the chip, not on the image behind it.
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button type="button" className={styles.chip} title={t("cropChipTitle")} onClick={onEnter}>
        <Crop size={14} aria-hidden />
        <span>{t("cropChip")}</span>
      </button>
    </div>
  );
}
