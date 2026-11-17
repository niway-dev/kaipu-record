import React, { useEffect, useRef, useState } from "react";
import { Check, ImageDown } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { formatSize } from "@renderer/features/library/format";
import { uiArea } from "@renderer/lib/ui-area";
import type { BackgroundId } from "../beautify/backgrounds";
import {
  EXPORT_SCALES,
  IMAGE_FORMATS,
  NAMED_PRESETS,
  QUALITY_MAX,
  QUALITY_MIN,
  QUALITY_STEP,
  flattensTransparency,
  isLossy,
  planExport,
  presetOf,
  settingsForPreset,
  settingsKey,
  withChange,
  type ImageExportSettings,
  type ImageFormat,
  type NamedPresetId,
  type PresetId,
} from "./image-export-settings";
import styles from "./export-image-control.module.css";

/** How long after the last change the real size is measured (one encode per pause). */
const ESTIMATE_DEBOUNCE_MS = 250;

const FORMAT_LABEL: Record<ImageFormat, string> = { png: "PNG", jpeg: "JPEG", webp: "WebP" };

interface ExportImageControlProps {
  settings: ImageExportSettings;
  /** The person changed a setting; the page remembers it. */
  onSettingsChange(settings: ImageExportSettings): void;
  /** The export frame's 1× size (what the export box shows), or null while it is unknown. */
  frame: { w: number; h: number } | null;
  /** The beautify background: JPEG over "None" has transparent areas to flatten. */
  bg: BackgroundId;
  open: boolean;
  onOpenChange(open: boolean): void;
  disabled: boolean;
  /** The name of the file just exported from here, for the button's done state. */
  exportedName: string | null;
  /** Encode for real with these settings and report the file size (the estimate). */
  measure(settings: ImageExportSettings): Promise<number>;
  /** Write the file: the save dialog follows. */
  onExport(settings: ImageExportSettings): void;
}

/**
 * The editor's image exporter (NIW2-852, canvas mode): a button that opens a small popover with
 * Preset, Format, Quality (JPEG and WebP), Scale, the resulting pixel size, the real file size and
 * Export. Settings are remembered by the page, so the next open starts where this one ended.
 */
export function ExportImageControl({
  settings,
  onSettingsChange,
  frame,
  bg,
  open,
  onOpenChange,
  disabled,
  exportedName,
  measure,
  onExport,
}: ExportImageControlProps): React.JSX.Element {
  const t = useTranslations("screenshots");
  const anchorRef = useRef<HTMLDivElement>(null);
  const preset = presetOf(settings);
  const plan = frame ? planExport(frame.w, frame.h, settings) : null;
  const lossy = isLossy(settings.format);

  // The real size: encode once per pause in changing settings, never per keystroke of a drag.
  const [estimate, setEstimate] = useState<number | "failed" | null>(null);
  const measureRef = useRef(measure);
  measureRef.current = measure;
  const key = settingsKey(settings);
  useEffect(() => {
    if (!open || !frame) return;
    let current = true;
    setEstimate(null);
    const timer = setTimeout(() => {
      measureRef
        .current(settings)
        .then((size) => current && setEstimate(size))
        .catch(() => current && setEstimate("failed"));
    }, ESTIMATE_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // `settings` is covered by `key`; `frame` by its sides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, frame?.w, frame?.h]);

  // Esc closes the popover only, ahead of the crop overlay's own listener (as the Add image menu does).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onOpenChange(false);
      anchorRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onOpenChange]);

  const presetLabel = (id: NamedPresetId | "custom"): string => {
    switch (id) {
      case "original":
        return t("exportPresetOriginal");
      case "web":
        return t("exportPresetWeb");
      case "small":
        return t("exportPresetSmall");
      case "custom":
        return t("exportPresetCustom");
    }
  };
  const presetCaption = (id: PresetId): string => {
    switch (id) {
      case "original":
        return t("exportCaptionOriginal");
      case "web":
        return t("exportCaptionWeb");
      case "small":
        return t("exportCaptionSmall");
      case "custom":
        return t("exportCaptionCustom");
    }
  };

  return (
    <div
      {...uiArea("editorImage.exportImage")}
      ref={anchorRef}
      className={styles.anchor}
      data-open={open}
    >
      <button
        type="button"
        className={styles.button}
        data-done={exportedName !== null}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={exportedName ? t("exportedPdfTitle", { name: exportedName }) : t("exportImageTitle")}
        onClick={() => onOpenChange(!open)}
      >
        {exportedName ? <Check size={16} /> : <ImageDown size={16} />}
        <span className={styles.label}>{exportedName ? t("exportedPdf") : t("exportImage")}</span>
      </button>
      {open && (
        <>
          <div className={styles.backdrop} onClick={() => onOpenChange(false)} aria-hidden />
          <div className={styles.popover} role="dialog" aria-label={t("exportImageDialog")}>
            <div className={styles.field}>
              <span className={styles.fieldLabel} id="export-preset-label">
                {t("exportPresetLabel")}
              </span>
              <div
                className={styles.segments}
                role="radiogroup"
                aria-labelledby="export-preset-label"
              >
                {NAMED_PRESETS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={preset === id}
                    className={styles.segment}
                    onClick={() => onSettingsChange(settingsForPreset(id))}
                  >
                    {presetLabel(id)}
                  </button>
                ))}
                {preset === "custom" && (
                  <button type="button" role="radio" aria-checked className={styles.segment}>
                    {presetLabel("custom")}
                  </button>
                )}
              </div>
              <p className={styles.caption}>{presetCaption(preset)}</p>
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel} id="export-format-label">
                {t("exportFormatLabel")}
              </span>
              <div
                className={styles.segments}
                role="radiogroup"
                aria-labelledby="export-format-label"
              >
                {IMAGE_FORMATS.map((format) => (
                  <button
                    key={format}
                    type="button"
                    role="radio"
                    aria-checked={settings.format === format}
                    className={styles.segment}
                    onClick={() => onSettingsChange(withChange(settings, { format }))}
                  >
                    {FORMAT_LABEL[format]}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="export-quality">
                {t("exportQualityLabel")}
                <span className={styles.value}>
                  {lossy ? `${Math.round(settings.quality * 100)}%` : t("exportLossless")}
                </span>
              </label>
              <input
                id="export-quality"
                type="range"
                className={styles.range}
                min={QUALITY_MIN}
                max={QUALITY_MAX}
                step={QUALITY_STEP}
                value={settings.quality}
                disabled={!lossy}
                onChange={(e) =>
                  onSettingsChange(withChange(settings, { quality: Number(e.target.value) }))
                }
              />
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel} id="export-scale-label">
                {t("exportScaleLabel")}
              </span>
              <div
                className={styles.segments}
                role="radiogroup"
                aria-labelledby="export-scale-label"
              >
                {EXPORT_SCALES.map((scale) => (
                  <button
                    key={scale}
                    type="button"
                    role="radio"
                    aria-checked={settings.scale === scale}
                    className={styles.segment}
                    onClick={() => onSettingsChange(withChange(settings, { scale }))}
                  >
                    {`${scale}×`}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.result} aria-live="polite">
              <span className={styles.pixels}>
                {plan ? t("exportPixelSize", { width: plan.width, height: plan.height }) : "—"}
              </span>
              <span
                className={styles.size}
                data-state={typeof estimate === "number" ? "ready" : "wait"}
              >
                {estimate === "failed"
                  ? t("exportEstimateFailed")
                  : estimate === null
                    ? t("exportEstimating")
                    : t("exportEstimate", { size: formatSize(estimate) })}
              </span>
            </div>

            {flattensTransparency(settings.format, bg) && (
              <p {...uiArea("editorImage.exportJpegNotice")} className={styles.notice} role="note">
                {t("exportJpegNotice")}
              </p>
            )}

            <button
              type="button"
              className={styles.primary}
              disabled={disabled || !frame}
              onClick={() => onExport(settings)}
            >
              <ImageDown size={16} />
              {t("exportAction")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
