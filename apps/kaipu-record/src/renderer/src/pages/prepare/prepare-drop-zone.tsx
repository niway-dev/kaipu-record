import { Download, FolderOpen, Library } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { Button } from "@kaipu/ui";
import styles from "./prepare-drop-zone.module.css";

interface PrepareDropZoneProps {
  /** Files are being dragged over the window: the zone lights up as the target. */
  active: boolean;
  importing: boolean;
  onChooseFile(): void;
  onFromLibrary(): void;
}

/**
 * The right column of Prepare with no recording (NIW2-587): a large target for an outside
 * video. The drop itself is caught by the whole window (`usePrepareImport`); this shows
 * where, and offers the file dialog and the Library as the other two ways in.
 */
export function PrepareDropZone({
  active,
  importing,
  onChooseFile,
  onFromLibrary,
}: PrepareDropZoneProps): React.JSX.Element {
  const t = useTranslations("prepare");
  return (
    <div className={styles.wrap}>
      <div className={styles.zone} data-active={active} data-testid="prepare-drop-zone">
        <Download size={34} strokeWidth={1.8} className={styles.icon} aria-hidden />
        <h2 className={styles.title}>
          {importing ? t("dropImporting") : active ? t("dropActive") : t("dropTitle")}
        </h2>
        <p className={styles.body}>{t("dropBody")}</p>
        <div className={styles.actions}>
          <Button variant="outline" disabled={importing} onClick={onChooseFile}>
            <FolderOpen size={14} strokeWidth={1.8} aria-hidden />
            {t("dropChooseFile")}
          </Button>
          <Button variant="outline" onClick={onFromLibrary}>
            <Library size={14} strokeWidth={1.8} aria-hidden />
            {t("dropFromLibrary")}
          </Button>
        </div>
      </div>
    </div>
  );
}
