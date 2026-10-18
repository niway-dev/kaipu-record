import { CircleCheck, FolderOpen, GripVertical, TriangleAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslations } from "@kaipu/i18n";
import { isWindowsHost } from "@renderer/features/shortcuts/host-platform";
import { PRESET_NAME } from "@renderer/features/video-editor/components/export-sheet";
import { GithubFitChips } from "@renderer/features/video-editor/components/github-fit-chips";
import { SizeMeter } from "@renderer/features/video-editor/components/size-meter";
import {
  cancelVideoExport,
  dismissReadyExport,
  type ExportJobInfo,
  type ReadyExport,
  retryVideoExport,
  useExportRunner,
} from "@renderer/features/video-editor/export/export-runner";
import { githubPlans, isQualityTier } from "@renderer/features/video-editor/export/export-presets";
import {
  exportEtaSeconds,
  formatMB,
  percentLighter,
  sizeKindOf,
} from "@renderer/features/video-editor/export/export-size";
import { StatusCard, StatusCardActions, StatusCardButton, StatusCardText } from "./status-card";
import styles from "./export-status-cards.module.css";

/** The background export's cards: progress (or its error) while it runs, then "Ready to share". */
export function ExportStatusCards(): React.JSX.Element {
  const runner = useExportRunner();
  return (
    <>
      {runner.status !== "idle" && runner.job && (
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
 * The export running in the background: what it makes, how far along, about how long is
 * left, and the size it is heading for. Cancel stops it; nothing reaches the Library.
 */
export function ExportProgressCard({
  job,
  status,
  fraction,
  error,
  attemptStartedAt,
  now = Date.now,
}: ExportProgressCardProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const name = t(PRESET_NAME[job.presetId]);
  const subtitle = `${name} · ${t("presetDimensions", { width: job.width, height: job.height })}`;

  if (status === "error") {
    return (
      <StatusCard
        label={t("exportError")}
        icon={<TriangleAlert size={18} strokeWidth={1.8} />}
        title={t("exportError")}
        subtitle={subtitle}
        onDismiss={cancelVideoExport}
        dismissLabel={t("close")}
      >
        <StatusCardText>{error}</StatusCardText>
        <StatusCardActions>
          <StatusCardButton variant="primary" onClick={retryVideoExport}>
            {t("retry")}
          </StatusCardButton>
          <StatusCardButton onClick={cancelVideoExport}>{t("close")}</StatusCardButton>
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
        ? t("etaSeconds", { seconds: eta })
        : t("etaMinutes", { minutes: Math.round(eta / 60) });
  const kind = sizeKindOf(job.presetId);
  const target =
    job.estimateBytes === null || kind === "full"
      ? null
      : kind === "up-to"
        ? t("sizeUpTo", { size: formatMB(job.estimateBytes) })
        : t("sizeAbout", { size: formatMB(job.estimateBytes) });
  const title =
    job.presetId === "maximum" ? t("exportProgressTitleFull") : t("exportProgressTitle");

  return (
    <StatusCard label={title} title={title} subtitle={subtitle}>
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
        <span>{etaText ? t("exportProgressEta", { percent, eta: etaText }) : `${percent}%`}</span>
        {target && job.sourceSizeBytes !== null && (
          <span className={styles.muted}>
            {t("exportProgressSizes", { from: formatMB(job.sourceSizeBytes), to: target })}
          </span>
        )}
      </div>
      <StatusCardActions>
        <span className={styles.spacer} />
        <StatusCardButton onClick={cancelVideoExport}>{t("cancel")}</StatusCardButton>
      </StatusCardActions>
    </StatusCard>
  );
}

/**
 * "Ready to share": the finished export with its real size against the original, a file
 * chip the user drags straight into GitHub, Slack or Finder (a native drag, under the
 * item's title rather than its vault id), View file (its Library page), Show in Finder and
 * Done.
 */
export function ExportReadyCard({ ready }: { ready: ReadyExport }): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const navigate = useNavigate();
  const { job, recording } = ready;
  const size = recording.sizeBytes;
  const lighter = percentLighter(size, job.sourceSizeBytes);
  // The quality tiers are the "share in a tool" files: say where on GitHub this one attaches,
  // from its real size. It never blocks anything.
  const tier = isQualityTier(job.presetId);
  const fitsGithubFree = githubPlans(size).free;
  const extension = recording.filePath.match(/\.[a-z0-9]+$/i)?.[0] ?? ".mp4";
  const fileName = `${recording.title}${extension}`;
  const hint = tier && fitsGithubFree ? t("readyDragHintTool") : t("readyDragHint");
  const title = t("readyTitle", { size: formatMB(size) });

  return (
    <StatusCard
      label={title}
      icon={<CircleCheck size={20} strokeWidth={1.8} />}
      title={title}
      subtitle={recording.title}
      onDismiss={dismissReadyExport}
      dismissLabel={t("readyDone")}
    >
      {lighter !== null && (
        <StatusCardText>{t("readyLighter", { percent: lighter })}</StatusCardText>
      )}
      {tier && <GithubFitChips bytes={size} />}
      {job.sourceSizeBytes !== null && job.sourceSizeBytes > 0 && (
        <SizeMeter originalBytes={job.sourceSizeBytes} resultBytes={size} label={formatMB(size)} />
      )}
      <div
        className={styles.fileChip}
        draggable
        role="button"
        tabIndex={-1}
        aria-label={t("readyDragLabel", { name: fileName })}
        onDragStart={(e) => {
          // Main runs a native drag (a real file), so the browser's own drag never starts.
          e.preventDefault();
          window.electronAPI.startFileDrag(recording.id, recording.title);
        }}
      >
        <GripVertical size={15} strokeWidth={1.8} className={styles.grip} aria-hidden />
        <span className={styles.fileBadge} aria-hidden>
          {extension.slice(1).toUpperCase()}
        </span>
        <span className={styles.fileText}>
          <span className={styles.fileName}>{fileName}</span>
          <span className={styles.fileHint}>{hint}</span>
        </span>
      </div>
      <StatusCardActions>
        <StatusCardButton
          variant="primary"
          onClick={() => {
            dismissReadyExport();
            navigate(`/library/${recording.assetId}`);
          }}
        >
          {t("readyViewFile")}
        </StatusCardButton>
        <StatusCardButton
          onClick={() => void window.electronAPI.revealLocalRecording(recording.id)}
        >
          <FolderOpen size={14} strokeWidth={1.8} />
          {t(isWindowsHost() ? "exportShowInFinderWindows" : "exportShowInFinder")}
        </StatusCardButton>
        <StatusCardButton onClick={dismissReadyExport}>{t("readyDone")}</StatusCardButton>
      </StatusCardActions>
    </StatusCard>
  );
}
