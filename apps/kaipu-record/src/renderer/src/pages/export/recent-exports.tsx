import { Check } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { LibraryVideo } from "@renderer/features/library/types";
import { DestinationLogo } from "@renderer/features/prepare/components/destination-logo";
import { destinationOfPreset } from "@renderer/features/prepare/destinations";
import { useExportRunner } from "@renderer/features/video-editor/export/export-runner";
import { formatMB } from "@renderer/features/video-editor/export/export-size";
import { EXPORT_NAME } from "./export-copy";
import styles from "./recent-exports.module.css";

/** How many rows the strip shows. */
const RECENT_COUNT = 3;

/** The newest exported copies in the Library (MP4s carrying an export preset), newest first. */
export function recentCopies(videos: readonly LibraryVideo[], count: number): LibraryVideo[] {
  return videos
    .filter((v) => v.kind === "recording" && v.derivedFromAssetId !== null && v.export)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, count);
}

/**
 * "Recent exports" under the drop zone: the copy being made now, with its progress, then the
 * newest finished ones, three in all. A finished row opens the copy's page.
 */
export function RecentExports({
  videos,
  onOpen,
}: {
  videos: readonly LibraryVideo[];
  onOpen(video: LibraryVideo): void;
}): React.JSX.Element {
  const t = useTranslations("export");
  const runner = useExportRunner();
  const running = runner.status === "exporting" && runner.job ? runner.job : null;
  const done = recentCopies(videos, running ? RECENT_COUNT - 1 : RECENT_COUNT);

  return (
    <section className={styles.panel} aria-labelledby="export-recent">
      <h2 id="export-recent" className={styles.label}>
        {t("recentTitle")}
      </h2>
      {!running && done.length === 0 ? (
        <p className={styles.empty}>{t("recentEmpty")}</p>
      ) : (
        <ul className={styles.grid}>
          {running && (
            <li className={styles.row}>
              <DestinationLogo
                destination={running.destination ?? destinationOfPreset(running.presetId)}
                size={30}
              />
              <span className={styles.text}>
                <span className={styles.name}>{running.sourceTitle}</span>
                <span className={styles.meta}>
                  {t("recentExporting", { percent: Math.round(runner.fraction * 100) })}
                </span>
              </span>
              <span className={styles.progress} aria-hidden>
                <span style={{ width: `${Math.round(runner.fraction * 100)}%` }} />
              </span>
            </li>
          )}
          {done.map((copy) => {
            const destination = destinationOfPreset(copy.export!.preset);
            return (
              <li key={copy.assetId}>
                <button type="button" className={styles.row} onClick={() => onOpen(copy)}>
                  <DestinationLogo destination={destination} size={30} />
                  <span className={styles.text}>
                    <span className={styles.name}>{t(EXPORT_NAME[destination])}</span>
                    <span className={styles.meta} title={copy.title}>
                      {formatMB(copy.fileSizeBytes)} · {copy.title}
                    </span>
                  </span>
                  <span className={styles.ready}>
                    <Check size={12} strokeWidth={2.4} aria-hidden />
                    {t("readyBadge")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
