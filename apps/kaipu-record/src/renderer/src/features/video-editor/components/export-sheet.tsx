import { Fragment, useEffect, useId, useRef, useState } from "react";
import { Check, Star, TriangleAlert, X } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { ModalOverlay, ModalText } from "@kaipu/ui";
import { formatSize } from "@renderer/features/library/format";
import type { LibraryVideo } from "@renderer/features/library/types";
import type { ReusableExports } from "../export/export-reuse";
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
  type ExportFraming,
  type ExportPresetId,
  type ExportSourceInfo,
  GITHUB_LIMIT_BYTES,
  type GithubFit,
  githubFit,
  PRESETS,
  type ResolvedExportTarget,
  resolveExportTarget,
} from "../export/export-presets";
import { addsBarsAt169, formatMB, sizeKindOf } from "../export/export-size";
import { FramingPreview } from "./framing-preview";
import { SizeMeter } from "./size-meter";
import styles from "./export-sheet.module.css";

export { formatMB };

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
   * Maximum), or the row a "Share a light copy" shortcut asks for. Another row applies to
   * this export only.
   */
  defaultPreset?: ExportPresetId;
  /** Heading; "Export" when omitted (Share passes "Share a copy"). */
  title?: string;
  /** The recording's title, for the subtitle (title · duration · resolution). */
  sourceTitle?: string;
  /**
   * The original file's size: drives the before/after meter and "N% lighter". Without it
   * the meter is left out (the estimates still show on every row).
   */
  sourceSizeBytes?: number | null;
  /** A frame of the recording, for the Vertical / Feeds framing preview. */
  thumbnailUrl?: string | null;
  /**
   * Files that already are what a row would produce (same source, preset and content, see
   * `findReusableExports`). Those rows say "Already exported · Open" and open the file
   * instead of encoding it again.
   */
  reusable?: ReusableExports;
  onOpenExisting?(recording: LibraryVideo): void;
  /** Called (on every change) with valid GIF settings while GIF is selected — drives the estimate. */
  onGifSettingsChange(settings: GifSettings | null): void;
  onExportVideo(choice: VideoExportChoice): void;
  onExportGif(settings: GifSettings): void;
  onCancel(): void;
  /** Show the Video / GIF format choice. Defaults to `GIF_EXPORT_ENABLED` (off while on hold). */
  gifEnabled?: boolean;
}

/**
 * The list, grouped by what the user is about to do with the file rather than by format:
 * nobody looks for "Small file", they look for where they will paste it.
 */
const GROUPS = [
  { label: "presetGroupRecommended", rows: ["balanced"] },
  { label: "presetGroupShare", rows: ["light"] },
  { label: "presetGroupPost", rows: ["youtube", "vertical", "square"] },
  { label: "presetGroupKeep", rows: ["maximum"] },
] as const satisfies ReadonlyArray<{ label: string; rows: readonly ExportPresetId[] }>;

export const PRESET_NAME = {
  balanced: "presetBalanced",
  youtube: "presetYoutube",
  vertical: "presetVertical",
  square: "presetSquare",
  light: "presetLight",
  maximum: "presetMaximum",
} as const satisfies Record<ExportPresetId, string>;

/** Where the file works, under the row's name. */
const PRESET_HINT = {
  balanced: "presetBalancedHint",
  youtube: "presetYoutubeHint",
  vertical: "presetVerticalHint",
  square: "presetSquareHint",
  light: "presetLightHint",
  maximum: "presetMaximumHint",
} as const satisfies Record<ExportPresetId, string>;

/** The one-line explanation the selected row opens with. */
const PRESET_SAY = {
  balanced: "presetBalancedSay",
  youtube: "presetYoutubeSay",
  vertical: "presetVerticalSay",
  square: "presetSquareSay",
  light: "presetLightSay",
  maximum: "presetMaximumSay",
} as const satisfies Record<ExportPresetId, string>;

type FactKey =
  | "factTextReadable"
  | "factPlaysEverywhere"
  | "factSmallest"
  | "factFitsGithub"
  | "factGithubTooBig"
  | "factBlackBars"
  | "factNothingLost"
  | "factHeavy";

/** Where a tier's copy lands against GitHub's limits — said, never enforced. */
const GITHUB_FIT_FACT = {
  fits: { key: "factFitsGithub" },
  "too-big": { key: "factGithubTooBig", warn: true },
} as const satisfies Record<GithubFit, Fact>;

interface Fact {
  key: FactKey;
  /** Amber: a trade-off the user should see, not a benefit. */
  warn?: boolean;
}

/**
 * The chips under the selected row. Only what holds for THIS source and length: whether the
 * tier's copy fits GitHub (from its estimate), the 16:9 bars only when the recording isn't
 * 16:9.
 */
export function presetFacts(target: ResolvedExportTarget, source: ExportSourceInfo): Fact[] {
  const fit = (): Fact[] =>
    target.estimateBytes === null ? [] : [GITHUB_FIT_FACT[githubFit(target.estimateBytes)]];
  switch (target.presetId) {
    case "balanced":
      return [{ key: "factTextReadable" }, { key: "factPlaysEverywhere" }, ...fit()];
    case "light":
      return [{ key: "factTextReadable" }, { key: "factSmallest" }, ...fit()];
    case "youtube":
      return addsBarsAt169(source.width, source.height)
        ? [{ key: "factBlackBars", warn: true }]
        : [];
    case "maximum":
      return [{ key: "factNothingLost" }, { key: "factHeavy", warn: true }];
    default:
      return [];
  }
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Which width options are usable: never wider than the source, but at least one. */
export function enabledGifWidths(sourceWidth: number): number[] {
  const fit = GIF_WIDTHS.filter((w) => w <= sourceWidth);
  return fit.length > 0 ? fit : [GIF_WIDTHS[0]];
}

/**
 * The export sheet, shared by the editor's Export ("Export") and the library's Share
 * ("Share a copy"). For video (NIW2-218 export redesign): a before/after size meter for the
 * selected row, then the rows grouped by intent — Recommended, Share in a tool, Post, Keep —
 * each with where it works, its size in MB and its output dimensions. The selected row opens
 * with a one-line explanation, ✓ facts, and for Vertical / Feeds a framing preview with
 * Fill / Fit. Enter exports the selected row. Never "bitrate" or "fps": MB, where it works,
 * whether text stays readable. For GIF (NIW2-217, on hold), the range, width and fps
 * controls with a live size estimate.
 */
export function ExportSheet({
  timelineDuration,
  sourceWidth,
  estimate,
  presetSource,
  defaultPreset = RECOMMENDED_PRESET,
  title,
  sourceTitle,
  sourceSizeBytes,
  thumbnailUrl,
  reusable = {},
  onOpenExisting,
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

  // "~9.2 MB", "up to ~78 MB", or "Full size" for Maximum (no estimate behind it).
  const sizeText = (target: ResolvedExportTarget): string => {
    const kind = sizeKindOf(target.presetId);
    if (kind === "full" || target.estimateBytes === null) return t("sizeFull");
    const size = formatMB(target.estimateBytes);
    return kind === "up-to" ? t("sizeUpTo", { size }) : t("sizeAbout", { size });
  };
  const meterLabel = (target: ResolvedExportTarget): string => {
    const kind = sizeKindOf(target.presetId);
    if (kind === "full" || target.estimateBytes === null) return t("meterFull");
    const size = formatMB(target.estimateBytes);
    return kind === "up-to" ? t("meterUpTo", { size }) : t("sizeAbout", { size });
  };
  // Amber when the copy would be no lighter than the original (or Maximum, which keeps it all).
  const isHeavy = (target: ResolvedExportTarget): boolean =>
    target.presetId === "maximum" ||
    (sourceSizeBytes != null &&
      target.estimateBytes !== null &&
      target.estimateBytes >= sourceSizeBytes);

  // Reuse only applies when the host can open the file.
  const existingOf = (p: ExportPresetId): LibraryVideo | undefined =>
    onOpenExisting ? reusable[p] : undefined;
  const selectedExisting = existingOf(presetId);
  const exportSelected = (): void => {
    if (selectedExisting) onOpenExisting?.(selectedExisting);
    else onExportVideo({ presetId, framing: framingOf(presetId) });
  };

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

  // The list scrolls; keep the selected row (and its opened details) in view — also when
  // the sheet opens on a row below the fold, e.g. GitHub from "Share a light copy".
  const rowRefs = useRef(new Map<ExportPresetId, HTMLDivElement>());
  useEffect(() => {
    rowRefs.current.get(presetId)?.scrollIntoView?.({ block: "nearest" });
  }, [presetId]);

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

  const renderRow = (p: ExportPresetId): React.JSX.Element => {
    const target = targetOf(p);
    const active = presetId === p;
    const existing = existingOf(p);
    const facts = presetFacts(target, presetSource);
    const framing = framingOf(p);
    const sizeId = `${id}-${p}-size`;
    return (
      // The whole card selects its row on click (the radio inside is the keyboard and
      // screen-reader control; this is only a bigger mouse target).
      <div
        key={p}
        ref={(el) => {
          if (el) rowRefs.current.set(p, el);
          else rowRefs.current.delete(p);
        }}
        className={styles.row}
        data-active={active}
        onClick={() => setPresetId(p)}
      >
        <div className={styles.rowHead}>
          <button
            type="button"
            role="radio"
            aria-checked={active}
            aria-describedby={sizeId}
            className={styles.rowRadio}
            onClick={() => setPresetId(p)}
          >
            <span className={styles.radioDot} aria-hidden />
            <span className={styles.rowText}>
              <span className={styles.rowName}>
                {t(PRESET_NAME[p])}
                {p === RECOMMENDED_PRESET && (
                  <span className={styles.recommended}>
                    <Star size={11} strokeWidth={1} fill="currentColor" aria-hidden />
                    {t("presetRecommended")}
                  </span>
                )}
              </span>
              <span className={styles.rowWhere}>{t(PRESET_HINT[p])}</span>
            </span>
          </button>
          {existing && (
            <button
              type="button"
              className={styles.exportedBadge}
              aria-label={t("openExportedLabel", { name: t(PRESET_NAME[p]) })}
              onClick={(e) => {
                e.stopPropagation();
                onOpenExisting?.(existing);
              }}
            >
              <Check size={11} strokeWidth={2.4} aria-hidden />
              {t("alreadyExportedOpen")}
            </button>
          )}
          <span className={styles.rowSize} id={sizeId}>
            <span className={styles.rowMb} data-heavy={isHeavy(target)}>
              {sizeText(target)}
            </span>
            <span className={styles.rowDims}>
              {t("presetDimensions", { width: target.width, height: target.height })}
            </span>
          </span>
        </div>

        {active && (
          <div className={styles.rowDetail}>
            <p className={styles.say}>{t(PRESET_SAY[p])}</p>

            {(p === "vertical" || p === "square") && framing && (
              <div className={styles.framing}>
                <FramingPreview
                  canvas={PRESETS[p].canvas!}
                  source={{ width: presetSource.width, height: presetSource.height }}
                  framing={framing}
                  thumbnailUrl={thumbnailUrl ?? null}
                />
                <div className={styles.framingControls}>
                  <div
                    className={styles.segmented}
                    role="radiogroup"
                    aria-label={t("framingLabel")}
                  >
                    {(["fill", "fit"] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        role="radio"
                        aria-checked={framing === f}
                        className={styles.segment}
                        data-active={framing === f}
                        onClick={() => setFramings((prev) => ({ ...prev, [p]: f }))}
                      >
                        {f === "fit" ? t("framingFit") : t("framingFill")}
                      </button>
                    ))}
                  </div>
                  <span className={styles.hint}>
                    {framing === "fit" ? t("framingFitHint") : t("framingFillHint")}
                  </span>
                </div>
              </div>
            )}

            {facts.length > 0 && (
              <ul className={styles.facts}>
                {facts.map((f) => (
                  <li key={f.key} className={styles.fact} data-warn={f.warn === true}>
                    {f.warn ? (
                      <TriangleAlert size={11} strokeWidth={2} aria-hidden />
                    ) : (
                      <Check size={11} strokeWidth={2.4} aria-hidden />
                    )}
                    {t(f.key, { limit: formatMB(GITHUB_LIMIT_BYTES) })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  };

  const primaryLabel = selectedExisting
    ? t("openExported")
    : sizeKindOf(presetId) === "full"
      ? t("exportFullAction")
      : t("exportSizeAction", { size: sizeText(selected) });

  return (
    <ModalOverlay onCancel={onCancel} labelledBy={`${id}-title`} size="wide">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h3 id={`${id}-title`} className={styles.title}>
            {title ?? t("exportSheetTitle")}
          </h3>
          {sourceTitle !== undefined && (
            <p className={styles.subtitle}>
              {t("exportSheetSubtitle", {
                title: sourceTitle,
                duration: formatDuration(timelineDuration),
                width: presetSource.width,
                height: presetSource.height,
              })}
            </p>
          )}
        </div>
        <button
          type="button"
          className={styles.close}
          aria-label={t("closeSheet")}
          onClick={onCancel}
        >
          <X size={14} strokeWidth={1.8} />
        </button>
      </header>

      {gifEnabled && (
        <div className={styles.body}>
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
        </div>
      )}

      {format === "video" && (
        <>
          {sourceSizeBytes != null && sourceSizeBytes > 0 && (
            <div className={styles.meter}>
              <SizeMeter
                originalBytes={sourceSizeBytes}
                resultBytes={selected.presetId === "maximum" ? null : selected.estimateBytes}
                label={meterLabel(selected)}
              />
            </div>
          )}
          <div className={styles.list} role="radiogroup" aria-label={t("presetLabel")}>
            {GROUPS.map((group) => (
              <Fragment key={group.label}>
                <div className={styles.groupLabel}>{t(group.label)}</div>
                {group.rows.map((p) => renderRow(p))}
              </Fragment>
            ))}
          </div>
        </>
      )}

      {format === "gif" && (
        <div className={styles.body}>
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
        </div>
      )}

      <footer className={styles.footer}>
        <span className={styles.note}>{format === "video" ? t("exportSheetNote") : null}</span>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          {t("cancel")}
        </button>
        {format === "video" ? (
          <button type="button" className={styles.primary} onClick={exportSelected}>
            {primaryLabel}
            <kbd className={styles.enterKey} aria-hidden>
              ↵
            </kbd>
          </button>
        ) : (
          <button
            type="button"
            className={styles.primary}
            disabled={!valid}
            onClick={() => valid && onExportGif({ range: { start, end }, width, fps })}
          >
            {t("exportGifAction")}
          </button>
        )}
      </footer>
    </ModalOverlay>
  );
}
