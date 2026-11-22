import { useEffect, useState } from "react";
import { Check, ChevronDown, Download } from "lucide-react";

import {
  DESTINATIONS,
  cropClip,
  cropTransform,
  EXPORT_FORMATS,
  EXPORT_RESOLUTIONS,
  YOUTUBE_RESOLUTIONS,
  estimateMegabytes,
  formatMegabytes,
  formatTime,
  keptSeconds,
  planDestination,
  workspaceFolder,
  type Clip,
  type DestinationId,
  type Mark,
  type Region,
  type ExportFormat,
  type ExportResolution,
  type ExportTarget,
  type WorkspaceId,
  type YoutubeResolution,
} from "./hero-stage-model";
import styles from "./hero-stage.module.css";
import {
  SampleScreen,
  Segmented,
  useWorkspaceLock,
  workspaceName,
  type T,
  type WorkspaceLock,
} from "./stage-parts";
import { InkMarks, type EditKind } from "./stage-edit";
import { useHold } from "./use-auto-demo";

type Phase = "idle" | "working" | "done";

const STEP_PERCENT = 12;
const STEP_MS = 140;

const DEST_COPY = {
  youtube: {
    name: "homeStageDestYoutube",
    line: "homeStageLineYoutube",
    next: "homeStageNextYoutube",
  },
  vertical: {
    name: "homeStageDestVertical",
    line: "homeStageLineVertical",
    next: "homeStageNextVertical",
  },
  square: { name: "homeStageDestSquare", line: "homeStageLineSquare", next: "homeStageNextSquare" },
  github: { name: "homeStageDestGithub", line: "homeStageLineGithub", next: "homeStageNextGithub" },
  chat: { name: "homeStageDestChat", line: "homeStageLineChat", next: "homeStageNextChat" },
  archive: {
    name: "homeStageDestArchive",
    line: "homeStageLineArchive",
    next: "homeStageNextArchive",
  },
} as const satisfies Record<DestinationId, { name: string; line: string; next: string }>;

/**
 * Export: the edited page stays on the canvas and the export panel opens over
 * it, anchored under the format button, as the app does. The visitor picks a
 * destination (the app's own: YouTube, Reels · TikTok · Shorts, LinkedIn · Feeds,
 * GitHub · Jira · Linear, Slack · Discord · Email, an archive copy), each with
 * its real preset, or "Custom" for the free format and size panel. The export
 * itself is simulated — a progress bar, then a result card saying what to do
 * next; nothing is encoded, uploaded or sent, and there is no upload action.
 * The file is added to the active workspace.
 */
export function ExportStage({
  t,
  kind,
  capture,
  marks,
  clip,
  workspace,
  onHold,
  onLock,
}: {
  t: T;
  /** What Edit was showing: an image is previewed with its crop and marks, a recording as the page. */
  kind: EditKind;
  capture: Region;
  marks: readonly Mark[];
  clip: Clip;
  workspace: WorkspaceId;
  onHold: (id: string, active: boolean) => void;
  onLock: (lock: WorkspaceLock) => void;
}) {
  const [target, setTarget] = useState<ExportTarget>("youtube");
  const [youtube, setYoutube] = useState<YoutubeResolution>("1440p");
  const [format, setFormat] = useState<ExportFormat>("mp4");
  const [resolution, setResolution] = useState<ExportResolution>("1440p");
  const [open, setOpen] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [percent, setPercent] = useState(0);
  const [savedIn, setSavedIn] = useState<WorkspaceId>(workspace);

  // An export in progress, or its result, is on screen for the visitor: the demo waits.
  useHold(onHold, "export", phase !== "idle");
  useWorkspaceLock(onLock, phase === "working" ? "exporting" : null);

  useEffect(() => {
    if (phase !== "working") return;
    const id = setInterval(() => setPercent((p) => Math.min(100, p + STEP_PERCENT)), STEP_MS);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase === "working" && percent >= 100) setPhase("done");
  }, [phase, percent]);

  const seconds = keptSeconds(clip);
  const dest = target === "custom" ? null : target;
  const plan = dest ? planDestination(dest, seconds, youtube) : null;
  const fileFormat: ExportFormat = plan ? plan.format : format;
  const size = plan
    ? plan.megabytes === null
      ? t("homeStageOriginalSize")
      : formatMegabytes(plan.megabytes)
    : formatMegabytes(estimateMegabytes(format, resolution, seconds));
  const picture = plan
    ? plan.picture
      ? `${plan.picture.w} × ${plan.picture.h}`
      : t("homeStageOriginalSize")
    : resolution;
  const file = `${t("homeStageFileName")}.${fileFormat}`;
  const folder = workspaceFolder(savedIn, workspaceName(t, savedIn));
  const targetLabel = dest ? t(DEST_COPY[dest].name) : t("homeStageDestCustom");
  const summary = dest
    ? [
        fileFormat.toUpperCase(),
        picture,
        plan?.maxFps ? t("homeStageFpsCap", { fps: plan.maxFps }) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const change =
    <V,>(set: (v: V) => void) =>
    (v: V) => {
      // A running export is not cancelled by a press (the controls say so with aria-disabled).
      // After the result, a press starts afresh.
      if (phase === "working") return;
      set(v);
      setPhase("idle");
    };
  const start = () => {
    setSavedIn(workspace);
    setPercent(0);
    setPhase("working");
  };

  return (
    <>
      <div className={styles.toolbar}>
        <span className={styles.mono}>{file}</span>
        <button
          type="button"
          className={`${styles.anchor} ${open ? styles.toolOn : ""}`}
          aria-expanded={open}
          aria-controls="kl-stage-export-panel"
          // While an export runs or shows its result the panel is the only place that says so.
          aria-disabled={phase !== "idle" || undefined}
          onClick={() => phase === "idle" && setOpen((v) => !v)}
        >
          <Download size={15} aria-hidden />
          {dest ? targetLabel : `${fileFormat.toUpperCase()} · ${resolution}`}
          <ChevronDown size={14} aria-hidden />
        </button>
      </div>

      <div className={`${styles.screen} ${styles.exportScreen}`}>
        {kind === "image" ? (
          <div className={styles.exportPicture}>
            <div
              className={styles.shot}
              data-testid="export-image"
              style={{ transform: cropTransform(capture), clipPath: cropClip(capture) }}
            >
              <SampleScreen t={t} download />
            </div>
            {marks.length > 0 && (
              <div className={styles.inkStatic} data-testid="export-marks" aria-hidden>
                <InkMarks t={t} marks={marks} />
              </div>
            )}
          </div>
        ) : (
          <SampleScreen t={t} download />
        )}

        {open && (
          <div className={styles.panel} id="kl-stage-export-panel">
            <div className={styles.destGroup} role="group" aria-label={t("homeStageDestination")}>
              {[...DESTINATIONS, "custom" as const].map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`${styles.destBtn} ${id === target ? styles.destOn : ""}`}
                  aria-pressed={id === target}
                  aria-disabled={phase === "working" || undefined}
                  onClick={() => change(setTarget)(id)}
                >
                  {id === "custom" ? t("homeStageDestCustom") : t(DEST_COPY[id].name)}
                </button>
              ))}
            </div>

            {dest ? (
              <div className={styles.destInfo}>
                <span className={styles.destLine}>{t(DEST_COPY[dest].line)}</span>
                <span className={styles.mono} data-testid="export-summary">
                  {summary}
                </span>
                {plan?.github && (
                  <span className={styles.resultNote}>
                    {plan.github.free
                      ? t("homeStageGithubFree")
                      : plan.github.paid
                        ? t("homeStageGithubPaid")
                        : t("homeStageGithubOver")}
                  </span>
                )}
              </div>
            ) : (
              <span className={styles.destLine}>{t("homeStageLineCustom")}</span>
            )}

            {dest === "youtube" && (
              <div className={styles.panelRow}>
                <span className={styles.panelLabel}>{t("homeStageResolution")}</span>
                <Segmented<YoutubeResolution>
                  label={t("homeStageResolution")}
                  value={youtube}
                  disabled={phase === "working"}
                  onChange={change(setYoutube)}
                  options={YOUTUBE_RESOLUTIONS.map((r) => ({ value: r, label: r }))}
                />
              </div>
            )}
            {!dest && (
              <>
                <div className={styles.panelRow}>
                  <span className={styles.panelLabel}>{t("homeStageFormat")}</span>
                  <Segmented<ExportFormat>
                    label={t("homeStageFormat")}
                    value={format}
                    disabled={phase === "working"}
                    onChange={change(setFormat)}
                    options={EXPORT_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))}
                  />
                </div>
                <div className={styles.panelRow}>
                  <span className={styles.panelLabel}>{t("homeStageResolution")}</span>
                  <Segmented<ExportResolution>
                    label={t("homeStageResolution")}
                    value={resolution}
                    disabled={phase === "working"}
                    onChange={change(setResolution)}
                    options={EXPORT_RESOLUTIONS.map((r) => ({ value: r, label: r }))}
                  />
                </div>
              </>
            )}

            {phase === "done" ? (
              <div className={styles.result} role="status">
                <span className={styles.done}>
                  <Check size={15} aria-hidden />
                </span>
                <span className={styles.resultText}>
                  <span className={styles.resultName}>{t("homeStageExported")}</span>
                  <span className={styles.mono}>
                    {file} · {size}
                  </span>
                  <span className={styles.resultNote}>
                    {dest ? t(DEST_COPY[dest].next) : t("homeStageNextCustom")}
                  </span>
                  <span className={styles.mono} data-testid="export-folder">
                    {t("homeStageExportedIn", {
                      workspace: workspaceName(t, savedIn),
                      folder,
                    })}
                  </span>
                  <span className={styles.faintNote}>{t("homeStageNoUpload")}</span>
                </span>
                <button type="button" className={styles.link} onClick={() => setPhase("idle")}>
                  {t("homeStageExportAgain")}
                </button>
              </div>
            ) : (
              <div className={styles.panelFoot} data-testid="export-footer">
                <div className={styles.panelFootRow}>
                  <span className={styles.mono}>
                    {fileFormat === "png" ? size : `${formatTime(seconds)} · ${size}`}
                  </span>
                  {phase === "working" ? (
                    <span className={styles.progressText}>
                      {t("homeStageExporting", { percent })}
                    </span>
                  ) : (
                    <button type="button" className={styles.dockPrimary} onClick={start}>
                      {t("homeStageExportCta")}
                    </button>
                  )}
                </div>
                {phase === "working" && (
                  <span className={styles.bar} data-testid="export-progress">
                    <span className={styles.barFill} style={{ width: `${percent}%` }} />
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
