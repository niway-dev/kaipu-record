import { Upload } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { cx } from "@renderer/ui/cx";
import styles from "./import-drop-zone.module.css";

interface ImportDropZoneProps {
  /** Files are being dragged over the Library: the zone lights up as the target. */
  active: boolean;
  importing: boolean;
  /** Clicking the zone opens the same file dialog as the header button. */
  onPick(): void;
  className?: string;
}

/**
 * The dashed "Drop a video here" strip (NIW2-579). The drop itself is caught by the whole
 * window while the Library is open (`useFileDrop`), so a video dropped anywhere imports;
 * this only shows where, and doubles as a second way to open the file dialog.
 */
export function ImportDropZone({
  active,
  importing,
  onPick,
  className,
}: ImportDropZoneProps): React.JSX.Element {
  const t = useTranslations("library");
  return (
    <button
      type="button"
      className={cx(styles.zone, className)}
      data-active={active}
      disabled={importing}
      onClick={onPick}
      data-testid="import-drop-zone"
    >
      <Upload size={16} strokeWidth={1.8} className={styles.icon} aria-hidden />
      {importing ? (
        <span className={styles.title}>{t("importing")}</span>
      ) : active ? (
        <span className={styles.title}>{t("importDropActive")}</span>
      ) : (
        <span>
          <span className={styles.title}>{t("importDropTitle")}</span>
          <span className={styles.hint}> — {t("importDropHint")}</span>
        </span>
      )}
    </button>
  );
}
