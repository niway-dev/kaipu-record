import { Link } from "react-router-dom";
import { Check, Film, ImagePlay } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { LibraryVideo } from "@renderer/features/library/types";
import { formatSize } from "@renderer/features/library/format";
import type { ExportPresetId } from "@renderer/features/video-editor/export/export-presets";
import { exportEtaSeconds } from "@renderer/features/video-editor/export/export-size";
import type { ExportRunnerSnapshot } from "@renderer/features/video-editor/export/export-runner";
import { copyPresetOf } from "../copy-destination";
import { destinationOfPreset } from "../destinations";
import { DESTINATION_COPY } from "../destination-copy";
import { DestinationLogo } from "./destination-logo";
import styles from "./master-copies-panel.module.css";

/** The background export of this master, while it runs (`useExportRunner`). */
export interface RunningCopy {
  presetId: ExportPresetId;
  /** A copy for a destination (Prepare, Share), not an editor export. */
  wholeRecording: boolean;
  fraction: number;
  /** When the current encode attempt started, for "about 2 min" left. */
  attemptStartedAt: number | null;
}

/** The runner's export when it is making a copy of `assetId`; null otherwise. */
export function runningCopyOf(
  snapshot: Pick<ExportRunnerSnapshot, "status" | "job" | "fraction" | "attemptStartedAt">,
  assetId: string,
): RunningCopy | null {
  const { job } = snapshot;
  if (snapshot.status !== "exporting" || job === null || job.sourceAssetId !== assetId) {
    return null;
  }
  return {
    presetId: job.presetId,
    wholeRecording: job.wholeRecording === true,
    fraction: snapshot.fraction,
    attemptStartedAt: snapshot.attemptStartedAt,
  };
}

interface MasterCopiesPanelProps {
  /** "master": the recording itself; "copy": a copy that has copies of its own. */
  source?: "master" | "copy";
  /** `buildLineage().exportsOf` for the master: newest first. */
  copies: readonly LibraryVideo[];
  running: RunningCopy | null;
  now?: () => number;
}

/**
 * "Copies from this master" (NIW2-585): every file made from the recording, with where it is
 * going and whether it is ready. A copy for a destination shows that destination; an editor
 * export or a GIF shows its own title.
 */
export function MasterCopiesPanel({
  source = "master",
  copies,
  running,
  now = Date.now,
}: MasterCopiesPanelProps): React.JSX.Element {
  const t = useTranslations("library");
  const tPrepare = useTranslations("prepare");
  const tEditor = useTranslations("videoEditor");

  const destinationName = (presetId: ExportPresetId): string => {
    const d = destinationOfPreset(presetId);
    const name = tPrepare(DESTINATION_COPY[d].name);
    if (presetId === "youtube-1440") return `${name} ${t("copyRes1440")}`;
    if (presetId === "youtube-4k") return `${name} ${t("copyRes4k")}`;
    return name;
  };

  const progressText = (job: RunningCopy): string => {
    const percent = Math.round(Math.min(1, Math.max(0, job.fraction)) * 100);
    const eta =
      job.attemptStartedAt !== null
        ? exportEtaSeconds(job.fraction, now() - job.attemptStartedAt)
        : null;
    if (eta === null) return t("copyProgressNoEta", { percent });
    const etaText =
      eta < 60
        ? tEditor("etaSeconds", { seconds: eta })
        : tEditor("etaMinutes", { minutes: Math.round(eta / 60) });
    return t("copyProgress", { percent, eta: etaText });
  };

  const empty = copies.length === 0 && running === null;

  return (
    <section className={styles.panel} aria-labelledby="master-copies-heading">
      <h2 id="master-copies-heading" className={styles.heading}>
        {source === "master" ? t("copiesHeading") : t("copiesHeadingCopy")}
      </h2>
      {empty ? (
        <p className={styles.empty}>{t("copiesEmpty")}</p>
      ) : (
        <ul className={styles.list}>
          {running && (
            <li className={styles.row} data-state="running">
              <CopyIcon preset={running.wholeRecording ? running.presetId : null} />
              <span className={styles.name}>
                {running.wholeRecording ? destinationName(running.presetId) : t("edited")}
              </span>
              <span className={styles.progress}>{progressText(running)}</span>
            </li>
          )}
          {copies.map((copy) => {
            const preset = copyPresetOf(copy);
            return (
              <li key={copy.assetId}>
                <Link to={`/library/${copy.assetId}`} className={styles.row} data-state="ready">
                  <CopyIcon preset={preset} gif={copy.kind === "gif"} />
                  <span className={styles.name}>
                    {preset ? destinationName(preset) : copy.title}{" "}
                    <span className={styles.size}>· {formatSize(copy.fileSizeBytes)}</span>
                  </span>
                  <span className={styles.ready}>
                    <Check size={11} strokeWidth={2.6} aria-hidden />
                    {t("copyReady")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The destination's tile; a plain film (or GIF) tile for a copy that has no destination. */
function CopyIcon({
  preset,
  gif = false,
}: {
  preset: ExportPresetId | null;
  gif?: boolean;
}): React.JSX.Element {
  if (preset) return <DestinationLogo destination={destinationOfPreset(preset)} size={26} />;
  const Icon = gif ? ImagePlay : Film;
  return (
    <span className={styles.genericIcon} aria-hidden>
      <Icon size={13} strokeWidth={1.9} />
    </span>
  );
}
