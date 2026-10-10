import { useEffect, useId, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { ModalActions, ModalButton, ModalOverlay, ModalText, ModalTitle } from "@kaipu/ui";
import { formatSize } from "@renderer/features/library/format";
import { gifRangeProblem } from "../export/export-plan";
import {
  GIF_FPS_OPTIONS,
  GIF_MAX_DURATION_S,
  GIF_MIN_DURATION_S,
  GIF_WARN_BYTES,
  GIF_WIDTHS,
  type GifFps,
} from "../export/gif-messages";
import type { GifEstimateState } from "../export/use-gif-export";
import styles from "./export-sheet.module.css";

export type ExportFormat = "video" | "gif";

export interface GifSettings {
  range: { start: number; end: number };
  width: number;
  fps: GifFps;
}

export interface ExportSheetProps {
  /** Edited-timeline length in seconds (after cuts, slides included). */
  timelineDuration: number;
  /** Native width of the source video; wider GIF widths are disabled. */
  sourceWidth: number;
  estimate: GifEstimateState;
  /** Called (on every change) with valid GIF settings while GIF is selected — drives the estimate. */
  onGifSettingsChange(settings: GifSettings | null): void;
  onExportVideo(): void;
  onExportGif(settings: GifSettings): void;
  onCancel(): void;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Which width options are usable: never wider than the source, but at least one. */
export function enabledGifWidths(sourceWidth: number): number[] {
  const fit = GIF_WIDTHS.filter((w) => w <= sourceWidth);
  return fit.length > 0 ? fit : [GIF_WIDTHS[0]];
}

/**
 * The editor's export sheet (NIW2-217): a format row (Video (MP4) / GIF) and, for GIF, the
 * range, width and fps controls with a live size estimate and the duration limits. Built so
 * NIW2-218 can add a presets row above the format row.
 */
export function ExportSheet({
  timelineDuration,
  sourceWidth,
  estimate,
  onGifSettingsChange,
  onExportVideo,
  onExportGif,
  onCancel,
}: ExportSheetProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const id = useId();
  const total = round1(timelineDuration);
  const widths = enabledGifWidths(sourceWidth);
  const [format, setFormat] = useState<ExportFormat>("video");
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(total);
  const [width, setWidth] = useState<number>(widths.includes(640) ? 640 : widths.at(-1)!);
  const [fps, setFps] = useState<GifFps>(15);

  const problem = gifRangeProblem(start, end, {
    min: GIF_MIN_DURATION_S,
    max: GIF_MAX_DURATION_S,
  });
  const valid = problem === null && start >= 0 && end <= total + 1e-6;

  // A ref, so a new callback identity from the parent never re-triggers an estimate.
  const onSettingsRef = useRef(onGifSettingsChange);
  onSettingsRef.current = onGifSettingsChange;
  useEffect(() => {
    onSettingsRef.current(format === "gif" && valid ? { range: { start, end }, width, fps } : null);
  }, [format, valid, start, end, width, fps]);

  const clamp = (n: number): number => Math.min(total, Math.max(0, Number.isFinite(n) ? n : 0));
  const setStartSafe = (n: number): void => setStart(round1(Math.min(clamp(n), end)));
  const setEndSafe = (n: number): void => setEnd(round1(Math.max(clamp(n), start)));

  const overWarn = estimate.status === "ready" && (estimate.bytes ?? 0) > GIF_WARN_BYTES;

  return (
    <ModalOverlay onCancel={onCancel} labelledBy={`${id}-title`}>
      <ModalTitle id={`${id}-title`}>{t("exportSheetTitle")}</ModalTitle>

      <div className={styles.field}>
        <span className={styles.label} id={`${id}-format`}>
          {t("exportFormatLabel")}
        </span>
        <div className={styles.segmented} role="radiogroup" aria-labelledby={`${id}-format`}>
          {(["video", "gif"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={format === f}
              className={styles.segment}
              data-active={format === f}
              onClick={() => setFormat(f)}
            >
              {f === "video" ? t("formatVideo") : t("formatGif")}
            </button>
          ))}
        </div>
      </div>

      {format === "gif" && (
        <>
          <div className={styles.field}>
            <span className={styles.label}>{t("gifRangeLabel")}</span>
            <div className={styles.rangeRow}>
              <label className={styles.numberField}>
                {t("gifRangeStart")}
                <input
                  type="number"
                  min={0}
                  max={total}
                  step={0.1}
                  value={start}
                  onChange={(e) => setStartSafe(e.currentTarget.valueAsNumber)}
                />
              </label>
              <label className={styles.numberField}>
                {t("gifRangeEnd")}
                <input
                  type="number"
                  min={0}
                  max={total}
                  step={0.1}
                  value={end}
                  onChange={(e) => setEndSafe(e.currentTarget.valueAsNumber)}
                />
              </label>
            </div>
            <div className={styles.slider}>
              <input
                type="range"
                aria-label={t("gifRangeStart")}
                min={0}
                max={total}
                step={0.1}
                value={start}
                onChange={(e) => setStartSafe(e.currentTarget.valueAsNumber)}
              />
              <input
                type="range"
                aria-label={t("gifRangeEnd")}
                min={0}
                max={total}
                step={0.1}
                value={end}
                onChange={(e) => setEndSafe(e.currentTarget.valueAsNumber)}
              />
            </div>
            <span className={styles.hint}>
              {t("gifRangeSummary", {
                start: `${start.toFixed(1)} s`,
                end: `${end.toFixed(1)} s`,
                duration: `${round1(end - start).toFixed(1)} s`,
              })}
            </span>
          </div>

          <div className={styles.field}>
            <span className={styles.label} id={`${id}-width`}>
              {t("gifWidthLabel")}
            </span>
            <div className={styles.segmented} role="radiogroup" aria-labelledby={`${id}-width`}>
              {GIF_WIDTHS.map((w) => {
                const disabled = !widths.includes(w);
                return (
                  <button
                    key={w}
                    type="button"
                    role="radio"
                    aria-checked={width === w}
                    className={styles.segment}
                    data-active={width === w}
                    disabled={disabled}
                    title={disabled ? t("gifWidthTooWide") : undefined}
                    onClick={() => setWidth(w)}
                  >
                    {t("gifWidthOption", { width: w })}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label} id={`${id}-fps`}>
              {t("gifFpsLabel")}
            </span>
            <div className={styles.segmented} role="radiogroup" aria-labelledby={`${id}-fps`}>
              {GIF_FPS_OPTIONS.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={fps === f}
                  className={styles.segment}
                  data-active={fps === f}
                  onClick={() => setFps(f)}
                >
                  {t("gifFpsOption", { fps: f })}
                </button>
              ))}
            </div>
            <span className={styles.hint}>{t("gifLoopNote")}</span>
          </div>

          <div className={styles.estimate} aria-live="polite">
            <span className={styles.label}>{t("gifEstimateLabel")}</span>
            <span>
              {problem !== null
                ? "—"
                : estimate.status === "ready" && estimate.bytes !== null
                  ? t("gifEstimate", { size: formatSize(estimate.bytes) })
                  : estimate.status === "error"
                    ? t("gifEstimateFailed")
                    : t("gifEstimating")}
            </span>
          </div>

          {problem !== null && (
            <ModalText>
              <span className={styles.blocked} role="alert">
                {problem === "too-short"
                  ? t("gifTooShort")
                  : t("gifTooLong", { max: GIF_MAX_DURATION_S })}
              </span>
            </ModalText>
          )}
          {problem === null && overWarn && (
            <p className={styles.warning}>
              <TriangleAlert size={14} strokeWidth={1.8} />
              {t("gifSizeWarning")}
            </p>
          )}
        </>
      )}

      <ModalActions>
        <ModalButton variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </ModalButton>
        {format === "video" ? (
          <ModalButton variant="primary" onClick={onExportVideo}>
            {t("exportVideoAction")}
          </ModalButton>
        ) : (
          <ModalButton
            variant="primary"
            disabled={!valid}
            onClick={() => valid && onExportGif({ range: { start, end }, width, fps })}
          >
            {t("exportGifAction")}
          </ModalButton>
        )}
      </ModalActions>
    </ModalOverlay>
  );
}
