import { ChevronDown, Film, Library } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { Button } from "@kaipu/ui";
import { formatDuration } from "@renderer/features/library/format";
import type { LibraryVideo } from "@renderer/features/library/types";
import { formatMB } from "@renderer/features/video-editor/export/export-size";
import type { SourceProbe } from "@renderer/features/video-editor/export/probe-source";
import { VideoPicker } from "./video-picker";
import styles from "./export-header.module.css";

interface ExportHeaderProps {
  video: LibraryVideo;
  probe: SourceProbe;
  /** The Library, for "Change video". */
  videos: readonly LibraryVideo[];
  onChangeVideo(video: LibraryVideo): void;
}

/**
 * The video being exported, always in view: a thumbnail, its title, ORIGINAL, and the line
 * that says copies are made from it and it never changes. "Change video" picks another
 * recording from the Library.
 */
export function ExportHeader({
  video,
  probe,
  videos,
  onChangeVideo,
}: ExportHeaderProps): React.JSX.Element {
  const t = useTranslations("export");
  return (
    <header className={styles.header}>
      <span className={styles.thumb}>
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt="" />
        ) : (
          <Film size={18} strokeWidth={1.6} aria-hidden />
        )}
      </span>
      <div className={styles.text}>
        <div className={styles.titleRow}>
          <h1 className={styles.title} title={video.title}>
            {video.title}
          </h1>
          <span className={styles.tag}>{t("originalTag")}</span>
        </div>
        <p className={styles.meta}>
          {t("headerMeta", {
            duration: formatDuration(probe.durationSec),
            width: probe.width,
            height: probe.height,
            size: formatMB(video.fileSizeBytes),
          })}
        </p>
      </div>
      <VideoPicker
        videos={videos}
        currentAssetId={video.assetId}
        onPick={onChangeVideo}
        trigger={(props) => (
          <Button variant="outline" {...props}>
            <Library size={13} strokeWidth={1.8} aria-hidden />
            {t("changeVideo")}
            <ChevronDown size={12} strokeWidth={1.8} aria-hidden />
          </Button>
        )}
      />
    </header>
  );
}

/** The header with no video yet: just the screen's name. */
export function ExportHeaderEmpty(): React.JSX.Element {
  const t = useTranslations("export");
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{t("pageTitle")}</h1>
    </header>
  );
}
