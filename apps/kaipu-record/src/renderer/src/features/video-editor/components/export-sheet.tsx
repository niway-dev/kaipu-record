import { useEffect, useId, useRef, useState } from "react";
import { Star, TriangleAlert } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { ModalActions, ModalButton, ModalOverlay, ModalText, ModalTitle } from "@kaipu/ui";
import { formatSize } from "@renderer/features/library/format";
import { gifRangeProblem } from "../export/export-plan";
import {
  GIF_EXPORT_ENABLED,
  GIF_FPS_OPTIONS,
  GIF_MAX_DURATION_S,
  GIF_MIN_DURATION_S,
  GIF_WARN_BYTES,
  GIF_WIDTHS,
  type GifFps,
} from "../export/gif-messages";
import type { GifEstimateState } from "../export/use-gif-export";
import {
  EXPORT_PRESET_IDS,
  type ExportFraming,
  type ExportPresetId,
  type ExportSourceInfo,
  PRESETS,
  resolveExportTarget,
} from "../export/export-presets";
import styles from "./export-sheet.module.css";

export type ExportFormat = "video" | "gif";

export interface GifSettings {
  range: { start: number; end: number };
  width: number;
  fps: GifFps;
}

/** What the user picked for the MP4 export (NIW2-218). */
export interface VideoExportChoice {
  presetId: ExportPresetId;
  /** Fit/Fill for Vertical and Square; null for the others. */
  framing: ExportFraming | null;
}

/** The row marked ⭐ Recommended; always first in the list. */
const RECOMMENDED_PRESET: ExportPresetId = "balanced";

/** Decimal megabytes, as the caps are counted (GitHub/Discord). */
export function formatMB(bytes: number): string {
  const mb = bytes / 1_000_000;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Seconds as M:SS. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface ExportSheetProps {
  /** Edited-timeline length in seconds (after cuts, slides included). */
  timelineDuration: number;
  /** Native width of the source video; wider GIF widths are disabled. */
  sourceWidth: number;
  estimate: GifEstimateState;
  /**
   * NIW2-218: source facts for the preset estimates (native size, frame rate, whether the
   * export carries audio). Pure math — the sheet reads no media.
   */
  presetSource: ExportSourceInfo;
  /**
   * The preselected row: Settings → Export quality (Balanced unless the user chose
   * Maximum). Another row applies to this export only.
   */
  defaultPreset?: ExportPresetId;
  /** Called (on every change) with valid GIF settings while GIF is selected — drives the estimate. */
  onGifSettingsChange(settings: GifSettings | null): void;
  onExportVideo(choice: VideoExportChoice): void;
  onExportGif(settings: GifSettings): void;
  onCancel(): void;
  /** Show the Video / GIF format choice. Defaults to `GIF_EXPORT_ENABLED` (off while on hold). */
  gifEnabled?: boolean;
}

const PRESET_NAME = {
  balanced: "presetBalanced",
  youtube: "presetYoutube",
  vertical: "presetVertical",
  square: "presetSquare",
  "small-10": "presetGithub",
  "small-25": "presetChat",
  maximum: "presetMaximum",
} as const satisfies Record<ExportPresetId, string>;

const PRESET_HINT = {
  balanced: "presetBalancedHint",
  youtube: "presetYoutubeHint",
  vertical: "presetVerticalHint",
  square: "presetSquareHint",
  "small-10": "presetGithubHint",
  "small-25": "presetChatHint",
  maximum: "presetMaximumHint",
} as const satisfies Record<ExportPresetId, string>;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Which width options are usable: never wider than the source, but at least one. */
export function enabledGifWidths(sourceWidth: number): number[] {
  const fit = GIF_WIDTHS.filter((w) => w <= sourceWidth);
  return fit.length > 0 ? fit : [GIF_WIDTHS[0]];
}

/**
 * The editor's export sheet: a format row (Video (MP4) / GIF). For video (NIW2-218), one
 * list with the recommended Balanced row first and Maximum quality last, each row with its
 * output size and a size estimate. Row-specific options (Fit/Fill for Vertical and Square,
 * the warning when a size cap can't be met) appear only for the selected row, and Enter
 * exports the selected row. For GIF (NIW2-217), the range, width and fps controls with a
 * live size estimate.
 */
export function ExportSheet({
  timelineDuration,
  sourceWidth,
  estimate,
  presetSource,
  defaultPreset = RECOMMENDED_PRESET,
  onGifSettingsChange,
  onExportVideo,
  onExportGif,
  onCancel,
  gifEnabled = GIF_EXPORT_ENABLED,
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
  const [presetId, setPresetId] = useState<ExportPresetId>(defaultPreset);
  const [framings, setFramings] = useState<Record<"vertical" | "square", ExportFraming>>({
    vertical: PRESETS.vertical.defaultFraming!,
    square: PRESETS.square.defaultFraming!,
  });
  const framingOf = (p: ExportPresetId): ExportFraming | null =>
    p === "vertical" || p === "square" ? framings[p] : null;
  const targetOf = (p: ExportPresetId) =>
    resolveExportTarget(p, presetSource, timelineDuration, { framing: framingOf(p) });
  const selected = targetOf(presetId);
  const estimateLine = (target: ReturnType<typeof targetOf>): string => {
    if (target.estimateBytes === null) return t("estimateMaximum");
    if (target.capBytes !== null) {
      return t("estimateSmall", { cap: formatMB(target.capBytes) });
    }
    return t("estimateUpTo", { size: formatMB(target.estimateBytes) });
  };
  const exportSelected = (): void => onExportVideo({ presetId, framing: framingOf(presetId) });

  // Enter exports the selected row. The modal focuses its overlay on mount, so this is a
  // document listener; Enter on a button or field keeps its own meaning (a row button
  // selects that row).
  const exportSelectedRef = useRef(exportSelected);
  exportSelectedRef.current = exportSelected;
  useEffect(() => {
    if (format !== "video") return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Enter" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("button, input, select, textarea")) return;
      e.preventDefault();
      exportSelectedRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [format]);

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

      {gifEnabled && (
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
      )}

      {format === "video" && (
        <>
          <div className={styles.field}>
            <span className={styles.label} id={`${id}-preset`}>
              {t("presetLabel")}
            </span>
            <div className={styles.presetList} role="radiogroup" aria-labelledby={`${id}-preset`}>
              {EXPORT_PRESET_IDS.map((p) => {
                const target = targetOf(p);
                const active = presetId === p;
                return (
                  <div key={p} className={styles.presetItem}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={styles.presetRow}
                      data-active={active}
                      onClick={() => setPresetId(p)}
                    >
                      <span className={styles.presetText}>
                        <span className={styles.presetName}>
                          {t(PRESET_NAME[p])}
                          {p === RECOMMENDED_PRESET && (
                            <span className={styles.recommended}>
                              <Star size={11} strokeWidth={2} aria-hidden />
                              {t("presetRecommended")}
                            </span>
                          )}
                        </span>
                        <span className={styles.presetMeta}>{t(PRESET_HINT[p])}</span>
                      </span>
                      <span className={styles.presetFacts}>
                        <span className={styles.presetMeta}>
                          {t("presetDimensions", { width: target.width, height: target.height })}
                        </span>
                        <span className={styles.presetMeta}>{estimateLine(target)}</span>
                      </span>
                    </button>

                    {active && (p === "vertical" || p === "square") && (
                      <div className={styles.rowOptions}>
                        <div
                          className={styles.segmented}
                          role="radiogroup"
                          aria-label={t("framingLabel")}
                        >
                          {(["fit", "fill"] as const).map((f) => (
                            <button
                              key={f}
                              type="button"
                              role="radio"
                              aria-checked={framings[p] === f}
                              className={styles.segment}
                              data-active={framings[p] === f}
                              onClick={() => setFramings((prev) => ({ ...prev, [p]: f }))}
                            >
                              {f === "fit" ? t("framingFit") : t("framingFill")}
                            </button>
                          ))}
                        </div>
                        <span className={styles.hint}>
                          {framings[p] === "fit" ? t("framingFitHint") : t("framingFillHint")}
                        </span>
                      </div>
                    )}

                    {active && !target.achievable && (
                      <div className={styles.rowOptions}>
                        <p className={styles.warning} role="alert">
                          <TriangleAlert size={14} strokeWidth={1.8} />
                          {t("smallNotAchievable", {
                            size: formatMB(target.estimateBytes ?? 0),
                            duration: formatDuration(target.maxDurationSec ?? 0),
                          })}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

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
          <ModalButton variant="primary" onClick={exportSelected}>
            {selected.achievable ? t("exportVideoAction") : t("exportAnywayAction")}
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
