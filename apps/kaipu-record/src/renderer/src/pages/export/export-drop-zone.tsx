import { Download, FolderOpen, Library } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { Button } from "@kaipu/ui";
import type { LibraryVideo } from "@renderer/features/library/types";
import { VideoPicker } from "./video-picker";
import styles from "./export-drop-zone.module.css";

interface ExportDropZoneProps {
  /** Files are being dragged over the window: the zone lights up as the target. */
  active: boolean;
  importing: boolean;
  /** The Library, for "Pick from Library". */
  videos: readonly LibraryVideo[];
  onPickVideo(video: LibraryVideo): void;
  onBrowseFiles(): void;
}

/**
 * Export with no video: the door for any video, from Kaipu or from outside. The drop itself is
 * caught by the whole window (`usePrepareImport`); this shows where, and offers the Library and
 * the file dialog as the other two ways in.
 */
export function ExportDropZone({
  active,
  importing,
  videos,
  onPickVideo,
  onBrowseFiles,
}: ExportDropZoneProps): React.JSX.Element {
  const t = useTranslations("export");
  return (
    <div className={styles.wrap}>
      <div className={styles.zone} data-active={active} data-testid="export-drop-zone">
        <Download size={30} strokeWidth={1.8} className={styles.icon} aria-hidden />
        <h2 className={styles.title}>
          {importing ? t("dropImporting") : active ? t("dropActive") : t("dropTitle")}
        </h2>
        <p className={styles.body}>{t("dropBody")}</p>
        <div className={styles.actions}>
          <VideoPicker
            videos={videos}
            onPick={onPickVideo}
            align="center"
            trigger={(props) => (
              <Button variant="primary" disabled={importing} {...props}>
                <Library size={14} strokeWidth={1.8} aria-hidden />
                {t("pickFromLibrary")}
              </Button>
            )}
          />
          <Button variant="outline" disabled={importing} onClick={onBrowseFiles}>
            <FolderOpen size={14} strokeWidth={1.8} aria-hidden />
            {t("browseFiles")}
          </Button>
        </div>
      </div>
    </div>
  );
}
