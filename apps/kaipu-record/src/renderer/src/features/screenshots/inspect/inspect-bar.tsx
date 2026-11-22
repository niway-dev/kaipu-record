import React, { useId } from "react";
import { Check, Copy, Minus, MoveHorizontal, MoveVertical, Palette, Plus } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import { COLOR_FORMATS, capturedFormat, type ColorFormat } from "./color";
import type { ColorsController } from "./colors/use-colors";
import { MAX_TOLERANCE, MIN_TOLERANCE } from "./pixel-run";
import { pickedReadout, type InspectController } from "./use-inspect";
import type { PickedColor } from "@shared/image-inspect-settings";
import styles from "./inspect-bar.module.css";

const FORMAT_LABEL: Record<ColorFormat, string> = {
  hex: "HEX",
  rgb: "RGB",
  hsl: "HSL",
  oklch: "OKLCH",
};

/** A picked color as a CSS color, for a swatch. */
const swatchColor = (picked: PickedColor): string => {
  const { r, g, b, a } = picked.color;
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
};

/**
 * The Inspect controls (mock B1, C2), in two labeled sections as the Tool tab's content while
 * Inspect is on (NIW2-723, NIW2-911).
 *
 * Color: the picked color (swatch, value in the current format, Copy), up to three recent picks,
 * the format, "As captured" and Colors. Ruler: Width, Height, Outer, Tolerance and the Loupe
 * switch. Every key Inspect answers to has a control here; the C key still copies what the chip
 * under the pointer shows. Exiting is the mode switch's Annotate segment or Esc, so there is no
 * exit button. The status lines sit at the end.
 */
export function InspectBar({
  inspect,
  colors,
}: {
  inspect: InspectController;
  /** The colors panel's toggle (NIW2-704). */
  colors?: ColorsController;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const colorTitleId = useId();
  const rulerTitleId = useId();
  const shownFormat = inspect.asCaptured ? capturedFormat(inspect.format) : inspect.format;
  const toleranceShown = inspect.toleranceShown;
  const ruler = (axis: "x" | "y"): void => inspect.setRuler(inspect.ruler === axis ? null : axis);
  const { picked, recents } = inspect;
  const text = (color: PickedColor): string =>
    pickedReadout(color, inspect.format, inspect.asCaptured);
  const pickedText = picked ? text(picked) : null;
  const justCopied = (value: string): boolean => inspect.copied && inspect.copiedText === value;
  return (
    <div
      {...uiArea("editorImage.inspectBar")}
      className={styles.bar}
      role="group"
      aria-label={t("inspectBarLabel")}
      data-format={shownFormat}
      data-as-captured={String(inspect.asCaptured)}
    >
      <div
        {...uiArea("editorImage.inspectColor")}
        className={styles.section}
        role="group"
        aria-labelledby={colorTitleId}
        data-picked={String(picked !== null)}
        data-recents={String(recents.length)}
      >
        <h3 id={colorTitleId} className={styles.sectionTitle}>
          {t("inspectColorSection")}
        </h3>
        <div className={styles.pickedBox} data-testid="inspect-picked">
          {picked ? (
            <span
              className={styles.pickedSwatch}
              style={{ background: swatchColor(picked) }}
              aria-hidden
            />
          ) : (
            <span className={`${styles.pickedSwatch} ${styles.pickedSwatchEmpty}`} aria-hidden />
          )}
          {pickedText ? (
            <span className={styles.pickedValue} data-testid="inspect-picked-value">
              {pickedText}
            </span>
          ) : (
            <span className={styles.pickedHint}>{t("inspectPickedEmpty")}</span>
          )}
          <button
            type="button"
            className={styles.barBtn}
            disabled={!pickedText}
            aria-label={
              pickedText && justCopied(pickedText)
                ? t("inspectCopied")
                : pickedText
                  ? t("inspectCopyValue", { color: pickedText })
                  : t("inspectCopy")
            }
            onClick={() => pickedText && void inspect.copyValue(pickedText)}
          >
            {pickedText && justCopied(pickedText) ? <Check size={14} /> : <Copy size={14} />}
            {t("inspectCopy")}
          </button>
        </div>
        {recents.length > 0 && (
          <div className={styles.recents} role="group" aria-label={t("inspectRecents")}>
            <span className={styles.recentsLabel} aria-hidden>
              {t("inspectRecents")}
            </span>
            <ul className={styles.recentsList}>
              {recents.map((color, index) => {
                const value = text(color);
                return (
                  <li key={`${index}-${value}`}>
                    <button
                      type="button"
                      className={styles.recentChip}
                      title={t("inspectCopyValue", { color: value })}
                      aria-label={
                        justCopied(value)
                          ? t("inspectCopied")
                          : t("inspectCopyValue", { color: value })
                      }
                      onClick={() => void inspect.copyValue(value)}
                    >
                      {justCopied(value) ? (
                        <Check size={12} className={styles.recentCheck} />
                      ) : (
                        <span
                          className={styles.recentSwatch}
                          style={{ background: swatchColor(color) }}
                          aria-hidden
                        />
                      )}
                      <span className={styles.recentValue}>{value}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
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
          className={`${styles.switchBtn} ${inspect.asCaptured ? styles.switchBtnOn : ""}`}
          aria-pressed={inspect.asCaptured}
          title={t("inspectAsCapturedTitle")}
          onClick={() => inspect.setAsCaptured(!inspect.asCaptured)}
        >
          <span className={styles.switchTrack} aria-hidden>
            <span className={styles.switchThumb} />
          </span>
          {t("inspectAsCaptured")}
        </button>
        {colors && (
          <div className={styles.barRow}>
            <button
              type="button"
              className={`${styles.barBtn} ${colors.open ? styles.barBtnOn : ""}`}
              aria-pressed={colors.open}
              title={t("inspectColorsTitle")}
              aria-label={t("inspectColors")}
              onClick={colors.toggle}
            >
              <Palette size={14} />
              {t("inspectColors")}
            </button>
          </div>
        )}
      </div>
      <span className={styles.divider} aria-hidden />
      <div
        {...uiArea("editorImage.inspectRuler")}
        className={styles.section}
        role="group"
        aria-labelledby={rulerTitleId}
        data-ruler={inspect.ruler ?? "off"}
        data-loupe={String(inspect.loupeShown)}
      >
        <h3 id={rulerTitleId} className={styles.sectionTitle}>
          {t("inspectRulerLabel")}
        </h3>
        <div className={styles.barRow}>
          <button
            type="button"
            className={`${styles.barBtn} ${inspect.ruler === "x" ? styles.barBtnOn : ""}`}
            aria-pressed={inspect.ruler === "x"}
            aria-label={t("inspectRulerX")}
            title={t("inspectRulerXTitle")}
            onClick={() => ruler("x")}
          >
            <MoveHorizontal size={14} />
            {t("inspectBarWidth")}
            <kbd className={styles.kbd}>1</kbd>
          </button>
          <button
            type="button"
            className={`${styles.barBtn} ${inspect.ruler === "y" ? styles.barBtnOn : ""}`}
            aria-pressed={inspect.ruler === "y"}
            aria-label={t("inspectRulerY")}
            title={t("inspectRulerYTitle")}
            onClick={() => ruler("y")}
          >
            <MoveVertical size={14} />
            {t("inspectBarHeight")}
            <kbd className={styles.kbd}>2</kbd>
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
        </div>
        <div
          className={styles.rulerTolerance}
          role="group"
          aria-label={t("inspectTolerance")}
          title={t("inspectToleranceTitle")}
        >
          <span className={styles.toleranceLabel} aria-hidden>
            {t("inspectTolerance")}
          </span>
          <button
            type="button"
            className={styles.segment}
            aria-label={t("inspectToleranceDown")}
            disabled={!inspect.ruler || inspect.tolerance <= MIN_TOLERANCE}
            onClick={() => inspect.setTolerance(inspect.tolerance - 1)}
          >
            <Minus size={12} />
          </button>
          <span
            className={`${styles.toleranceValue} ${toleranceShown ? styles.toleranceValueShown : ""}`}
            data-testid="inspect-tolerance"
            data-shown={String(toleranceShown)}
          >
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
        <button
          type="button"
          className={`${styles.switchBtn} ${inspect.loupeShown ? styles.switchBtnOn : ""}`}
          aria-pressed={inspect.loupeShown}
          title={t("inspectLoupeTitle")}
          onClick={() => inspect.setLoupeShown(!inspect.loupeShown)}
        >
          <span className={styles.switchTrack} aria-hidden>
            <span className={styles.switchThumb} />
          </span>
          {t("inspectLoupe")}
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
