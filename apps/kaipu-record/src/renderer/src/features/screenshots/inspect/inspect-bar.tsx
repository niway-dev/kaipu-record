import React from "react";
import { Check, Copy, Minus, MoveHorizontal, MoveVertical, Plus, X } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import { COLOR_FORMATS, capturedFormat, type ColorFormat } from "./color";
import { MAX_TOLERANCE, MIN_TOLERANCE } from "./pixel-run";
import type { InspectController } from "./use-inspect";
import styles from "./inspect.module.css";

const FORMAT_LABEL: Record<ColorFormat, string> = {
  hex: "HEX",
  rgb: "RGB",
  hsl: "HSL",
  oklch: "OKLCH",
};

/**
 * The Inspect bar: format switch, "As captured", Copy and exit. Every key Inspect answers to
 * has a control here. It takes the place of the per-tool options while Inspect is on.
 */
export function InspectBar({ inspect }: { inspect: InspectController }): React.JSX.Element {
  const t = useTranslations("screenshots");
  const shownFormat = inspect.asCaptured ? capturedFormat(inspect.format) : inspect.format;
  return (
    <div
      {...uiArea("editorImage.inspectBar")}
      className={styles.bar}
      role="group"
      aria-label={t("inspectBarLabel")}
      data-format={shownFormat}
      data-as-captured={String(inspect.asCaptured)}
    >
      <div className={styles.barRow}>
        <div className={styles.segments} role="group" aria-label={t("inspectFormat")}>
          {COLOR_FORMATS.map((format) => (
            <button
              key={format}
              type="button"
              className={`${styles.segment} ${shownFormat === format ? styles.segmentOn : ""}`}
              aria-pressed={shownFormat === format}
              disabled={inspect.asCaptured && format !== capturedFormat(format)}
              onClick={() => inspect.setFormat(format)}
            >
              {FORMAT_LABEL[format]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`${styles.barBtn} ${inspect.asCaptured ? styles.barBtnOn : ""}`}
          aria-pressed={inspect.asCaptured}
          title={t("inspectAsCapturedTitle")}
          onClick={() => inspect.setAsCaptured(!inspect.asCaptured)}
        >
          {t("inspectAsCaptured")}
        </button>
      </div>
      <div
        {...uiArea("editorImage.inspectRuler")}
        className={styles.barRow}
        role="group"
        aria-label={t("inspectRulerLabel")}
        data-ruler={inspect.ruler ?? "off"}
      >
        <button
          type="button"
          className={`${styles.barBtn} ${inspect.ruler === "x" ? styles.barBtnOn : ""}`}
          aria-pressed={inspect.ruler === "x"}
          title={t("inspectRulerXTitle")}
          onClick={() => inspect.setRuler(inspect.ruler === "x" ? null : "x")}
        >
          <MoveHorizontal size={14} />
          {t("inspectRulerX")}
        </button>
        <button
          type="button"
          className={`${styles.barBtn} ${inspect.ruler === "y" ? styles.barBtnOn : ""}`}
          aria-pressed={inspect.ruler === "y"}
          title={t("inspectRulerYTitle")}
          onClick={() => inspect.setRuler(inspect.ruler === "y" ? null : "y")}
        >
          <MoveVertical size={14} />
          {t("inspectRulerY")}
        </button>
        <button
          type="button"
          className={`${styles.barBtn} ${inspect.outer ? styles.barBtnOn : ""}`}
          aria-pressed={inspect.outer}
          title={t("inspectOuterTitle")}
          disabled={!inspect.ruler}
          onClick={() => inspect.setOuterLocked(!inspect.outerLocked)}
        >
          {t("inspectOuter")}
        </button>
        <div
          className={styles.rulerTolerance}
          role="group"
          aria-label={t("inspectTolerance")}
          title={t("inspectToleranceTitle")}
        >
          <button
            type="button"
            className={styles.segment}
            aria-label={t("inspectToleranceDown")}
            disabled={!inspect.ruler || inspect.tolerance <= MIN_TOLERANCE}
            onClick={() => inspect.setTolerance(inspect.tolerance - 1)}
          >
            <Minus size={12} />
          </button>
          <span className={styles.toleranceValue} data-testid="inspect-tolerance">
            {inspect.tolerance}
          </span>
          <button
            type="button"
            className={styles.segment}
            aria-label={t("inspectToleranceUp")}
            disabled={!inspect.ruler || inspect.tolerance >= MAX_TOLERANCE}
            onClick={() => inspect.setTolerance(inspect.tolerance + 1)}
          >
            <Plus size={12} />
          </button>
        </div>
      </div>
      <div className={styles.barRow}>
        <button
          type="button"
          className={styles.barBtn}
          title={t("inspectCopyTitle")}
          aria-label={inspect.copied ? t("inspectCopied") : t("inspectCopy")}
          onClick={() => void inspect.copy()}
        >
          {inspect.copied ? <Check size={14} /> : <Copy size={14} />}
          {inspect.copied ? t("inspectCopied") : t("inspectCopy")}
        </button>
        <button
          type="button"
          className={styles.barBtn}
          title={t("inspectExitTitle")}
          aria-label={t("inspectExit")}
          onClick={() => inspect.setActive(false)}
        >
          <X size={14} />
          {t("inspectExit")}
        </button>
      </div>
      {inspect.status === "decoding" && (
        <span className={styles.status}>{t("inspectReading")}</span>
      )}
      {inspect.status === "ready" && inspect.asCaptured && inspect.capturedUnavailable && (
        <span className={styles.status}>{t("inspectCapturedUnavailable")}</span>
      )}
      {inspect.status === "error" && (
        <span className={styles.status}>{t("inspectUnavailable")}</span>
      )}
    </div>
  );
}
