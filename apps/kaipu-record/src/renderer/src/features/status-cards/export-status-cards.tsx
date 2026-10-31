import { ChevronUp, FolderOpen, GripVertical, Clapperboard, TriangleAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { KaipuLogo } from "@kaipu/brand";
import { useTranslations } from "@kaipu/i18n";
import { DestinationLogo } from "@renderer/features/prepare/components/destination-logo";
import { isWindowsHost } from "@renderer/features/shortcuts/host-platform";
import { PRESET_NAME } from "@renderer/features/video-editor/components/export-sheet";
import { GithubFitChips } from "@renderer/features/video-editor/components/github-fit-chips";
import {
  cancelVideoExport,
  dismissReadyExport,
  type ExportJobInfo,
  type ReadyExport,
  retryVideoExport,
  useExportRunner,
} from "@renderer/features/video-editor/export/export-runner";
import { isQualityTier } from "@renderer/features/video-editor/export/export-presets";
import {
  exportEtaSeconds,
  formatMB,
  sizeKindOf,
} from "@renderer/features/video-editor/export/export-size";
import { markCopySeen } from "@renderer/features/video-editor/export/ready-copies";
import { setExportWidgetMinimized, useExportWidgetMinimized } from "./export-widget-state";
import { StatusCard, StatusCardActions, StatusCardButton, StatusCardText } from "./status-card";
import styles from "./export-status-cards.module.css";

/**
 * The background export's cards (NIW2-586), bottom right on every screen: the progress
 * widget (or its error) while it runs, then "ready". The widget minimizes to a pill with a
 * progress ring — the export keeps going, the choice holds for the session, and an error
 * always shows in full.
 */
export function ExportStatusCards(): React.JSX.Element {
  const runner = useExportRunner();
  const minimized = useExportWidgetMinimized();
  const { job, status } = runner;
  return (
    <>
      {job && status === "exporting" && minimized && (
        <ExportProgressPill job={job} fraction={runner.fraction} />
      )}
      {job && (status === "error" || (status === "exporting" && !minimized)) && (
        <ExportProgressCard
          job={job}
          status={status}
          fraction={runner.fraction}
          error={runner.error}
          attemptStartedAt={runner.attemptStartedAt}
        />
      )}
      {runner.ready && <ExportReadyCard ready={runner.ready} />}
    </>
  );
}

function percentOf(fraction: number): number {
  return Math.round(Math.min(1, Math.max(0, fraction)) * 100);
}

/** The ICU `select` value the card titles name: the destination, or "your export". */
function destinationArg(job: ExportJobInfo): string {
  return job.destination ?? "export";
}

/** The destination's own tile when Prepare started the copy; a neutral clapper otherwise. */
function JobIcon({ job }: { job: ExportJobInfo }): React.JSX.Element {
  return job.destination ? (
    <DestinationLogo destination={job.destination} size={36} />
  ) : (
    <span className={styles.genericIcon}>
      <Clapperboard size={18} strokeWidth={1.8} />
    </span>
  );
}

export interface ExportProgressCardProps {
  job: ExportJobInfo;
  status: "exporting" | "error";
  fraction: number;
  error: string | null;
  attemptStartedAt: number | null;
  /** Injected in tests; Date.now otherwise. */
  now?: () => number;
}

/**
 * The export running in the background: where it is going, how far along and about how long
 * is left, with a striped bar. − minimizes it to a pill and leaves the export running; Cancel
 * stops it, and nothing reaches the Library.
 */
export function ExportProgressCard({
  job,
  status,
  fraction,
  error,
  attemptStartedAt,
  now = Date.now,
}: ExportProgressCardProps): React.JSX.Element {
  const t = useTranslations("backgroundCopy");
  const tEditor = useTranslations("videoEditor");

  if (status === "error") {
    const name = tEditor(PRESET_NAME[job.presetId]);
    return (
      <StatusCard
        label={tEditor("exportError")}
        icon={<TriangleAlert size={18} strokeWidth={1.8} />}
        title={tEditor("exportError")}
        subtitle={`${name} · ${tEditor("presetDimensions", { width: job.width, height: job.height })}`}
        onDismiss={cancelVideoExport}
        dismissLabel={tEditor("close")}
      >
        <StatusCardText>{error}</StatusCardText>
        <StatusCardActions>
          <StatusCardButton variant="primary" onClick={retryVideoExport}>
            {tEditor("retry")}
          </StatusCardButton>
          <StatusCardButton onClick={cancelVideoExport}>{tEditor("close")}</StatusCardButton>
        </StatusCardActions>
      </StatusCard>
    );
  }

  const percent = percentOf(fraction);
  const eta =
    attemptStartedAt !== null ? exportEtaSeconds(fraction, now() - attemptStartedAt) : null;
  const etaText =
    eta === null
      ? null
      : eta < 60
        ? tEditor("etaSeconds", { seconds: eta })
        : tEditor("etaMinutes", { minutes: Math.round(eta / 60) });
  const kind = sizeKindOf(job.presetId);
  const target =
    job.estimateBytes === null || kind === "full"
      ? null
      : kind === "up-to"
        ? tEditor("sizeUpTo", { size: formatMB(job.estimateBytes) })
        : tEditor("sizeAbout", { size: formatMB(job.estimateBytes) });
  const title = t("progressTitle", { destination: destinationArg(job) });

  return (
    <StatusCard
      label={title}
      icon={<JobIcon job={job} />}
      bareIcon
      title={title}
      subtitle={
        etaText ? t("progressLineEta", { percent, eta: etaText }) : t("progressLine", { percent })
      }
      onDismiss={() => setExportWidgetMinimized(true)}
      dismissLabel={t("minimize")}
      dismissIcon="minimize"
    >
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={title}
      >
        <div className={styles.progressFill} style={{ width: `${percent}%` }} />
      </div>
      <p className={styles.note}>{t("progressNote")}</p>
      <div className={styles.progressLine}>
        {target && job.sourceSizeBytes !== null ? (
          <span>{t("progressSizes", { from: formatMB(job.sourceSizeBytes), to: target })}</span>
        ) : (
          <span />
        )}
        <StatusCardButton variant="text" onClick={cancelVideoExport}>
          {t("cancel")}
        </StatusCardButton>
      </div>
    </StatusCard>
  );
}

/** The ring's radius in the pill's 24 × 24 box. */
const RING_RADIUS = 9;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The minimized widget: a pill with a progress ring and "YouTube copy · 38%". Clicking it
 * opens the widget again (where Cancel is).
 */
export function ExportProgressPill({
  job,
  fraction,
}: {
  job: ExportJobInfo;
  fraction: number;
}): React.JSX.Element {
  const t = useTranslations("backgroundCopy");
  const percent = percentOf(fraction);
  return (
    <button
      type="button"
      className={styles.pill}
      aria-label={t("expand")}
      onClick={() => setExportWidgetMinimized(false)}
    >
      <svg className={styles.ring} width={24} height={24} viewBox="0 0 24 24" aria-hidden>
        <circle className={styles.ringTrack} cx={12} cy={12} r={RING_RADIUS} />
        <circle
          className={styles.ringFill}
          cx={12}
          cy={12}
          r={RING_RADIUS}
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - percent / 100)}
        />
      </svg>
      <span
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("progressTitle", { destination: destinationArg(job) })}
      >
        {t("pill", { destination: destinationArg(job), percent })}
      </span>
      <ChevronUp size={13} strokeWidth={1.9} aria-hidden />
    </button>
  );
}

/**
 * The finished copy: the fox, where it went, its real size and that it is in the Library
 * (a link to its page). Show in Finder, and "Drag to YouTube Studio" (or wherever it is going)
 * — a native drag of the real file, under the item's title rather than its vault id,
 * straight into an upload page.
 * ✕ closes the card; the copy stays pointed at in the Library until it is opened.
 */
export function ExportReadyCard({ ready }: { ready: ReadyExport }): React.JSX.Element {
  const t = useTranslations("backgroundCopy");
  const tEditor = useTranslations("videoEditor");
  const navigate = useNavigate();
  const { job, recording } = ready;
  const size = recording.sizeBytes;
  const extension = recording.filePath.match(/\.[a-z0-9]+$/i)?.[0] ?? ".mp4";
  const fileName = `${recording.title}${extension}`;
  const title = t("readyTitle", { destination: destinationArg(job) });

  return (
    <StatusCard
      label={title}
      icon={<KaipuLogo use="done" size={36} />}
      bareIcon
      title={title}
      subtitle={
        <>
          {t("readyLine", { width: job.width, height: job.height, size: formatMB(size) })}
          {" · "}
          <button
            type="button"
            className={styles.libraryLink}
            aria-label={t("readyOpenLabel", { name: recording.title })}
            onClick={() => {
              dismissReadyExport();
              navigate(`/library/${recording.assetId}`);
            }}
          >
            {t("readyInLibrary")}
          </button>
        </>
      }
      onDismiss={dismissReadyExport}
      dismissLabel={t("close")}
    >
      {/* The light tiers are the "attach it in a tool" files: say where on GitHub this one
          fits, from its real size. It never blocks anything. */}
      {isQualityTier(job.presetId) && <GithubFitChips bytes={size} />}
      <StatusCardActions>
        <StatusCardButton
          variant="primary"
          onClick={() => {
            markCopySeen(recording.assetId);
            void window.electronAPI.revealLocalRecording(recording.id);
          }}
        >
          <FolderOpen size={14} strokeWidth={1.8} />
          {tEditor(isWindowsHost() ? "exportShowInFinderWindows" : "exportShowInFinder")}
        </StatusCardButton>
        <StatusCardButton
          grow
          label={t("readyDragLabel", { name: fileName })}
          onDragStart={(e) => {
            // Main runs a native drag (a real file), so the browser's own drag never starts.
            e.preventDefault();
            markCopySeen(recording.assetId);
            window.electronAPI.startFileDrag(recording.id, recording.title);
          }}
        >
          <GripVertical size={14} strokeWidth={1.8} />
          {t("dragTo", { destination: destinationArg(job) })}
        </StatusCardButton>
      </StatusCardActions>
    </StatusCard>
  );
}
