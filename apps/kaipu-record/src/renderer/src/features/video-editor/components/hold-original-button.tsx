/**
 * "Hold to see original" (UI spec § 4.5): while pressed, the preview shows the raw frame —
 * no camera, no camera box, no privacy regions, no annotations — and an
 * "ORIGINAL · UNEDITED" chip. The only honest way to judge the edit, and the only state
 * where a secret is readable.
 */
import { Eye } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import styles from "./hold-original-button.module.css";

export function HoldOriginalButton({
  holding,
  onHoldChange,
}: {
  holding: boolean;
  onHoldChange(holding: boolean): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const release = (): void => onHoldChange(false);
  return (
    <>
      {holding && <span className={styles.chip}>{t("originalChip")}</span>}
      <button
        type="button"
        aria-pressed={holding}
        className={holding ? `${styles.button} ${styles.active}` : styles.button}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          onHoldChange(true);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        // Fallback only, and only while actually holding: once setPointerCapture
        // succeeds the pointer never "leaves" the button, so pointerup/pointercancel
        // end every real hold. Unguarded, this fired a state write on every hover-out.
        onPointerLeave={() => {
          if (holding) onHoldChange(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== " " && event.key !== "Enter") return;
          // Keep Space from also reaching the page's play/pause shortcut.
          event.preventDefault();
          event.stopPropagation();
          onHoldChange(true);
        }}
        onKeyUp={(event) => {
          if (event.key === " " || event.key === "Enter") release();
        }}
      >
        <Eye size={14} />
        {t("holdOriginal")}
      </button>
    </>
  );
}
