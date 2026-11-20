import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Film, GripVertical, ImagePlay, Info, Pencil } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { LibraryVideo } from "@renderer/features/library/types";
import { formatDuration, formatSize, relativeDate } from "@renderer/features/library/format";
import { familyOf, type buildLineage } from "@renderer/features/library/lineage";
import {
  type ExportPresetId,
  resolveExportTarget,
} from "@renderer/features/video-editor/export/export-presets";
import { exportEtaSeconds } from "@renderer/features/video-editor/export/export-size";
import type { SourceProbe } from "@renderer/features/video-editor/export/probe-source";
import { copyDestinationOf, copyPresetOf } from "@renderer/features/prepare/copy-destination";
import { type DestinationId, destinationOfPreset } from "@renderer/features/prepare/destinations";
import { DESTINATION_COPY } from "@renderer/features/prepare/destination-copy";
import { DestinationLogo } from "@renderer/features/prepare/components/destination-logo";
import type { runningCopyOf } from "@renderer/features/prepare/running-copy";
import { markCopySeen } from "@renderer/features/video-editor/export/ready-copies";
import styles from "./versions-list.module.css";
import { uiArea } from "@renderer/lib/ui-area";

interface VersionsListProps {
  /** The item the page shows. */
  item: LibraryVideo;
  lineage: ReturnType<typeof buildLineage>;
  /** The background export of the original, while it runs. */
  running: ReturnType<typeof runningCopyOf>;
  /** The viewed item's file as probed. A destination copy's picture size is computed from it only
   *  when the viewed item is the master; on a copy it is ignored. */
  probe: SourceProbe | null;
  /** The list the page walks with previous and next; a row's link carries it along, so opening
   *  another version keeps the walk (and its counter) instead of resetting to the whole library. */
  order?: string[];
  /** The item has the "Where is it going?" tab (a local recording), so the empty state can point
   *  to it. Without that tab the sentence would name a place that does not exist. */
  canExport?: boolean;
  now?: () => number;
}

/**
 * "Versions" tab: the original (never changes), its edited project when there is one, every
 * exported copy, and the copy being made right now. The row of the item on screen carries a
 * "Viewing" pill; every other row opens its own page.
 */
export function VersionsList({
  item,
  lineage,
  running,
  probe,
  order,
  canExport = false,
  now = Date.now,
}: VersionsListProps): React.JSX.Element {
  const t = useTranslations("library");
  const tPrepare = useTranslations("prepare");
  const tEditor = useTranslations("videoEditor");

  const { master, copies } = familyOf(item, lineage);
  const sourceDeleted = master === null;
  // The probe is the viewed item's file; only the master's file sizes every copy's picture.
  const masterProbe = master !== null && master.assetId === item.assetId ? probe : null;

  const hasEdit = master !== null && master.kind === "recording" && master.editSavedAt !== null;
  const count = (master || sourceDeleted ? 1 : 0) + (hasEdit ? 1 : 0) + copies.length;

  const destinationName = (presetId: ExportPresetId, destination?: DestinationId | null) => {
    const d = destination ?? destinationOfPreset(presetId);
    const name = tPrepare(DESTINATION_COPY[d].name);
    if (presetId === "youtube-1440") return `${name} ${t("copyRes1440")}`;
    if (presetId === "youtube-4k") return `${name} ${t("copyRes4k")}`;
    return name;
  };

  const progressText = (job: NonNullable<typeof running>): string => {
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

  const factsOf = (copy: LibraryVideo, preset: ExportPresetId | null): string => {
    const parts: string[] = [];
    const dims = copy.gif
      ? { width: copy.gif.width, height: copy.gif.height }
      : preset && masterProbe
        ? resolveExportTarget(preset, masterProbe, masterProbe.durationSec)
        : null;
    if (dims) parts.push(t("metaDimensions", { width: dims.width, height: dims.height }));
    parts.push(formatSize(copy.fileSizeBytes));
    if (copy.kind !== "screenshot" && copy.durationSeconds > 0) {
      parts.push(formatDuration(copy.durationSeconds));
    }
    parts.push(relativeDate(copy.createdAt));
    return parts.join(" · ");
  };

  const viewing = (assetId: string): boolean => assetId === item.assetId;
  const empty = copies.length === 0 && running === null;
  // With nothing but the original, its row repeats the image shown beside the panel; a line
  // that says this is the original replaces it.
  const onlyOriginal = empty && !hasEdit && master !== null && viewing(master.assetId);

  return (
    <section
      {...uiArea("libraryDetail.versions")}
      className={styles.root}
      aria-labelledby="versions-heading"
    >
      <div className={styles.head}>
        <h2 id="versions-heading" className={styles.title}>
          {tPrepare("versionsHeading")}
        </h2>
        <span className={styles.count}>{count}</span>
      </div>
      <ul className={styles.rows}>
        {master && !onlyOriginal && (
          <Row
            assetId={master.assetId}
            current={viewing(master.assetId)}
            order={order}
            viewingLabel={tPrepare("versionsViewing")}
            icon={<Thumb video={master} />}
            name={master.title}
            kind={
              <span className={styles.kindWithInfo}>
                {tPrepare("versionsOriginal")}
                <span
                  className={styles.info}
                  title={tPrepare("versionsNeverChanges")}
                  aria-label={tPrepare("versionsNeverChanges")}
                  role="img"
                >
                  <Info size={11} strokeWidth={2} aria-hidden />
                </span>
              </span>
            }
            facts={factsOf(master, null)}
          />
        )}
        {sourceDeleted && (
          <li className={styles.row} data-state="missing">
            <span className={styles.genericIcon} aria-hidden>
              <Film size={14} strokeWidth={1.9} />
            </span>
            <span className={styles.text}>
              <span className={styles.name}>{t("sourceDeleted")}</span>
            </span>
          </li>
        )}
        {hasEdit && master && (
          <li className={styles.row} data-state="edited">
            <span className={styles.genericIcon} aria-hidden>
              <Pencil size={13} strokeWidth={1.9} />
            </span>
            <span className={styles.text}>
              <span className={styles.name}>{tPrepare("versionsEditedProject")}</span>
              <span className={styles.facts}>{relativeDate(master.editSavedAt!)}</span>
            </span>
          </li>
        )}
        {running && (
          <li className={styles.row} data-state="running">
            <CopyIcon
              destination={
                running.wholeRecording
                  ? (running.destination ?? destinationOfPreset(running.presetId))
                  : null
              }
            />
            <span className={styles.text}>
              <span className={styles.name}>
                {running.wholeRecording
                  ? destinationName(running.presetId, running.destination)
                  : t("edited")}
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
          const preset = copyPresetOf(copy);
          const destination = copyDestinationOf(copy);
          const name = preset ? destinationName(preset, destination) : copy.title;
          return (
            <Row
              key={copy.assetId}
              assetId={copy.assetId}
              current={viewing(copy.assetId)}
              order={order}
              dragSource={
                copy.id !== null ? { id: copy.id, assetId: copy.assetId, title: copy.title } : null
              }
              dragLabel={t("copyDragLabel", { name })}
              dragText={t("copyDrag")}
              viewingLabel={tPrepare("versionsViewing")}
              icon={
                copy.thumbnailUrl ? (
                  <Thumb video={copy} />
                ) : (
                  <CopyIcon destination={destination} gif={copy.kind === "gif"} />
                )
              }
              name={name}
              kind={tPrepare("versionsExportedCopy")}
              facts={factsOf(copy, preset)}
            />
          );
        })}
      </ul>
      {empty && (
        <p className={styles.empty}>
          {onlyOriginal
            ? canExport
              ? tPrepare("versionsOnlyOriginal")
              : tPrepare("versionsOnlyOriginalPlain")
            : canExport
              ? tPrepare("versionsEmpty")
              : tPrepare("versionsEmptyPlain")}
        </p>
      )}
    </section>
  );
}

function Row({
  assetId,
  current,
  order,
  dragSource = null,
  dragLabel,
  dragText,
  viewingLabel,
  icon,
  name,
  kind,
  facts,
}: {
  assetId: string;
  current: boolean;
  order?: string[];
  /** A local exported copy: its file can be dragged into another app. */
  dragSource?: { id: string; assetId: string; title: string } | null;
  dragLabel?: string;
  dragText?: string;
  viewingLabel: string;
  icon: ReactNode;
  name: string;
  kind: ReactNode;
  facts: string;
}): React.JSX.Element {
  const body = (
    <>
      {icon}
      <span className={styles.text}>
        <span className={styles.name}>{name}</span>
        <span className={styles.facts}>
          {kind} · {facts}
        </span>
      </span>
    </>
  );
  const drag = dragSource && (
    <button
      type="button"
      draggable
      // Drag only: Enter and Space cannot drag; the row's own link opens the copy.
      tabIndex={-1}
      className={styles.drag}
      aria-label={dragLabel}
      title={dragLabel}
      onDragStart={(e) => {
        // Main runs a native drag (a real file), so the browser's own never starts.
        e.preventDefault();
        // Dragging it out is acting on it, as from the export card.
        markCopySeen(dragSource.assetId);
        window.electronAPI.startFileDrag(dragSource.id, dragSource.title);
      }}
    >
      <GripVertical size={12} strokeWidth={1.8} aria-hidden />
      {dragText}
    </button>
  );
  if (current) {
    return (
      <li className={styles.row} data-state="viewing" aria-current="true">
        <div className={styles.inner}>{body}</div>
        <span className={styles.pill}>{viewingLabel}</span>
      </li>
    );
  }
  return (
    <li className={styles.row} data-state="ready">
      <Link
        to={`/library/${assetId}`}
        state={order ? { order } : undefined}
        className={styles.link}
      >
        {body}
      </Link>
      {drag}
    </li>
  );
}

function Thumb({ video }: { video: LibraryVideo }): React.JSX.Element {
  if (video.thumbnailUrl) {
    return <img src={video.thumbnailUrl} alt="" className={styles.thumb} />;
  }
  return <CopyIcon destination={null} gif={video.kind === "gif"} />;
}

function CopyIcon({
  destination,
  gif = false,
}: {
  destination: DestinationId | null;
  gif?: boolean;
}): React.JSX.Element {
  if (destination) return <DestinationLogo destination={destination} size={30} />;
  const Icon = gif ? ImagePlay : Film;
  return (
    <span className={styles.genericIcon} aria-hidden>
      <Icon size={14} strokeWidth={1.9} />
    </span>
  );
}
