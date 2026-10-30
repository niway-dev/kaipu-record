import { FolderOpen, GripVertical, Clapperboard, TriangleAlert } from "lucide-react";
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
  hideExportProgress,
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
import { StatusCard, StatusCardActions, StatusCardButton, StatusCardText } from "./status-card";
import styles from "./export-status-cards.module.css";

/**
 * The background export's cards (NIW2-586): progress (or its error) while it runs, then
 * "ready". The progress card can be hidden — the export keeps going, and an error brings it
 * back.
 */
export function ExportStatusCards(): React.JSX.Element {
  const runner = useExportRunner();
  const showProgress =
    runner.job !== null &&
    (runner.status === "error" || (runner.status === "exporting" && !runner.progressHidden));
  return (
    <>
      {showProgress && runner.job && runner.status !== "idle" && (
        <ExportProgressCard
          job={runner.job}
          status={runner.status}
          fraction={runner.fraction}
          error={runner.error}
          attemptStartedAt={runner.attemptStartedAt}
        />
      )}
      {runner.ready && <ExportReadyCard ready={runner.ready} />}
    </>
  );
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
 * is left, with a striped bar. ✕ hides the card and leaves the export running; Cancel stops
 * it, and nothing reaches the Library.
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

  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
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
      onDismiss={hideExportProgress}
      dismissLabel={t("hide")}
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

/**
 * The finished copy: the fox, where it went, its real size and that it is in the Library
 * (a link to its page). Show in Finder, and "Drag to upload" — a native drag of the real
 * file, under the item's title rather than its vault id, straight into an upload page.
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
          {t("readyDragToUpload")}
        </StatusCardButton>
      </StatusCardActions>
    </StatusCard>
  );
}
