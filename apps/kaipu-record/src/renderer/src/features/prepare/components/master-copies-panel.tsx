import { Link } from "react-router-dom";
import { Check, Film, GripVertical, ImagePlay } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { LibraryVideo } from "@renderer/features/library/types";
import { formatSize } from "@renderer/features/library/format";
import {
  type ExportPresetId,
  resolveExportTarget,
} from "@renderer/features/video-editor/export/export-presets";
import { isWholeFingerprint } from "@renderer/features/video-editor/export/export-reuse";
import { exportEtaSeconds } from "@renderer/features/video-editor/export/export-size";
import type { ExportRunnerSnapshot } from "@renderer/features/video-editor/export/export-runner";
import type { SourceProbe } from "@renderer/features/video-editor/export/probe-source";
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
  /**
   * The source as read from the file: a destination copy's picture size follows from it and
   * its preset. Without it a row shows only the file size.
   */
  probe?: SourceProbe | null;
  /** "Open in Export →": the export screen for this recording; omitted where there is none. */
  onOpenExport?(): void;
  now?: () => number;
}

/**
 * "Copies from this original" (Export v3, section 2; NIW2-585): every file made from the
 * recording, two to a row — where it is going, its picture and file size, whether it is
 * ready — with a Drag handle that hands the real file to another app. A copy's name links to
 * its own page, which links back here. The caller renders it only when there is something to
 * list.
 */
export function MasterCopiesPanel({
  source = "master",
  copies,
  running,
  probe = null,
  onOpenExport,
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
    if (eta === null) return t("copyExportingNoEta", { percent });
    const etaText =
      eta < 60
        ? tEditor("etaSeconds", { seconds: eta })
        : tEditor("etaMinutes", { minutes: Math.round(eta / 60) });
    return t("copyExporting", { percent, eta: etaText });
  };

  /** "2560 × 1440 · 566 MB", or just the size when the picture size is not known. */
  const factsOf = (copy: LibraryVideo, preset: ExportPresetId | null): string => {
    const size = formatSize(copy.fileSizeBytes);
    const dims = copy.gif
      ? { width: copy.gif.width, height: copy.gif.height }
      : preset && probe
        ? resolveExportTarget(preset, probe, probe.durationSec)
        : null;
    return dims
      ? `${t("metaDimensions", { width: dims.width, height: dims.height })} · ${size}`
      : size;
  };

  return (
    <section className={styles.panel} aria-labelledby="master-copies-heading">
      <div className={styles.head}>
        <h2 id="master-copies-heading" className={styles.heading}>
          {source === "master" ? t("copiesHeading") : t("copiesHeadingCopy")}
        </h2>
        {onOpenExport && (
          <button type="button" className={styles.openExport} onClick={onOpenExport}>
            {t("copiesOpenInExport")}
          </button>
        )}
      </div>
      <ul className={styles.grid}>
        {running && (
          <li className={styles.row} data-state="running">
            <CopyIcon preset={running.wholeRecording ? running.presetId : null} />
            <span className={styles.text}>
              <span className={styles.name}>
                {running.wholeRecording ? destinationName(running.presetId) : t("edited")}
              </span>
              <span className={styles.facts}>{progressText(running)}</span>
            </span>
            <span className={styles.bar} aria-hidden>
              <span
                className={styles.barFill}
                style={{
                  width: `${Math.round(Math.min(1, Math.max(0, running.fraction)) * 100)}%`,
                }}
              />
            </span>
          </li>
        )}
        {copies.map((copy) => {
          const preset = destinationPresetOf(copy);
          const name = preset ? destinationName(preset) : copy.title;
          return (
            <li key={copy.assetId} className={styles.row} data-state="ready">
              <Link to={`/library/${copy.assetId}`} className={styles.link}>
                <CopyIcon preset={preset} gif={copy.kind === "gif"} />
                <span className={styles.text}>
                  <span className={styles.name}>{name}</span>
                  <span className={styles.facts}>{factsOf(copy, preset)}</span>
                </span>
                <span className={styles.ready}>
                  <Check size={11} strokeWidth={2.6} aria-hidden />
                  {t("copyReady")}
                </span>
              </Link>
              {copy.id !== null && (
                <button
                  type="button"
                  draggable
                  className={styles.drag}
                  aria-label={t("copyDragLabel", { name })}
                  title={t("copyDragLabel", { name })}
                  onDragStart={(e) => {
                    // Main runs a native drag (a real file), so the browser's own never starts.
                    e.preventDefault();
                    window.electronAPI.startFileDrag(copy.id!, copy.title);
                  }}
                >
                  <GripVertical size={12} strokeWidth={1.8} aria-hidden />
                  {t("copyDrag")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The preset of a copy made for a destination; null for an editor export, a GIF or an older file. */
function destinationPresetOf(copy: LibraryVideo): ExportPresetId | null {
  if (copy.kind !== "recording" || !copy.export) return null;
  return isWholeFingerprint(copy.export.fingerprint ?? undefined) ? copy.export.preset : null;
}

/** The destination's tile; a plain film (or GIF) tile for a copy that has no destination. */
function CopyIcon({
  preset,
  gif = false,
}: {
  preset: ExportPresetId | null;
  gif?: boolean;
}): React.JSX.Element {
  if (preset) return <DestinationLogo destination={destinationOfPreset(preset)} size={30} />;
  const Icon = gif ? ImagePlay : Film;
  return (
    <span className={styles.genericIcon} aria-hidden>
      <Icon size={14} strokeWidth={1.9} />
    </span>
  );
}
