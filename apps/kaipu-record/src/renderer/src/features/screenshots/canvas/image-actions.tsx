import React, { useEffect, useId, useState } from "react";
import { Crop, RotateCcw, SquareRoundCorner } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import styles from "./image-actions.module.css";

/** What the actions need to know about the selected image. */
export interface ImageActionsProps {
  /** `bar` floats over the image (dark pill); `panel` sits in the Tool tab. */
  variant: "bar" | "panel";
  /** There is a crop to remove: Reset is disabled without one. */
  hasCrop: boolean;
  /** Crop mode is open on this image: Crop is shown pressed (the Tool tab keeps the actions). */
  cropping?: boolean;
  /** This image's own corner radius in SOURCE px; absent = it follows the Beautify slider. */
  radius?: number;
  /** What the Beautify slider gives this image, in source px: shown while it follows. */
  followRadius: number;
  /** The largest useful radius, in source px: half the shorter visible side. */
  maxRadius: number;
  /** Crop: the same crop mode a double-click on the image opens. */
  onCrop(): void;
  /** Reset: remove this image's crop (one undo step). */
  onResetCrop(): void;
  /** Corners: set this image's own radius, or `undefined` to follow the slider again. */
  onRadius(radius: number | undefined): void;
}

/**
 * Crop, Corners and Reset for one selected image, the base or an added one (NIW2-876). One
 * component, two homes: the floating bar over the image and the Tool tab (spec "Interaction").
 *
 * Corners opens a small control under the buttons (inline in the Tool tab): a slider and a
 * number field in source px, and "Follow slider" to give the image back to the Beautify
 * slider. A drag of the slider is one change, committed when it is released, so it is one
 * undo step rather than one per pixel.
 */
export function ImageActions({
  variant,
  hasCrop,
  cropping = false,
  radius,
  followRadius,
  maxRadius,
  onCrop,
  onResetCrop,
  onRadius,
}: ImageActionsProps): React.JSX.Element {
  const t = useTranslations("screenshots");
  const [cornersOpen, setCornersOpen] = useState(false);
  const panelId = useId();
  return (
    <div
      className={`${styles.actions} ${variant === "bar" ? styles.bar : styles.panel}`}
      data-variant={variant}
      // The Tool tab's copy is usable in crop mode: the page's click-away leaves it alone.
      {...(variant === "panel" ? { "data-keeps-crop-mode": "" } : {})}
    >
      <div className={styles.row} role="group" aria-label={t("imageActionsAria")}>
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          title={t("imageActionCropTitle")}
          aria-pressed={cropping}
          onClick={onCrop}
        >
          <Crop size={13} aria-hidden />
          {t("imageActionCrop")}
        </button>
        <button
          type="button"
          className={styles.button}
          title={t("imageActionCornersTitle")}
          aria-expanded={cornersOpen}
          aria-controls={panelId}
          data-open={cornersOpen || undefined}
          onClick={() => setCornersOpen((o) => !o)}
        >
          <SquareRoundCorner size={13} aria-hidden />
          {t("imageActionCorners")}
        </button>
        <button
          type="button"
          className={styles.button}
          title={t("imageActionResetTitle")}
          disabled={!hasCrop}
          onClick={onResetCrop}
        >
          <RotateCcw size={13} aria-hidden />
          {t("imageActionReset")}
        </button>
      </div>
      <div id={panelId} className={styles.host} hidden={!cornersOpen}>
        {cornersOpen && (
          <CornersControl
            radius={radius}
            followRadius={followRadius}
            maxRadius={maxRadius}
            onRadius={onRadius}
          />
        )}
      </div>
    </div>
  );
}

const clampRadius = (v: number, max: number): number =>
  Math.min(Math.max(0, Math.round(v)), Math.max(0, Math.floor(max)));

function CornersControl({
  radius,
  followRadius,
  maxRadius,
  onRadius,
}: Pick<
  ImageActionsProps,
  "radius" | "followRadius" | "maxRadius" | "onRadius"
>): React.JSX.Element {
  const t = useTranslations("screenshots");
  // Bounded like a commit, so a follow radius above the visible area's limit does not read as a
  // change when the field is merely left.
  const shown = clampRadius(radius ?? followRadius, maxRadius);
  // What the controls show while they are being edited; the scene hears it on commit.
  const [draft, setDraft] = useState(String(shown));
  useEffect(() => setDraft(String(shown)), [shown]);
  const commit = (): void => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n)) {
      setDraft(String(shown));
      return;
    }
    const next = clampRadius(n, maxRadius);
    setDraft(String(next));
    // Leaving a field untouched must keep "follows the slider", so only a change is a choice.
    if (next !== shown) onRadius(next);
  };
  return (
    <div className={styles.corners} data-testid="corners-control">
      <div className={styles.cornersLabel}>
        <span>{t("imageCornersLabel")}</span>
        <div className={styles.cornersInputs}>
          <input
            type="range"
            aria-label={t("imageCornersLabel")}
            className={styles.slider}
            min={0}
            max={Math.max(1, Math.floor(maxRadius))}
            step={1}
            value={Math.min(Number(draft) || 0, Math.max(1, Math.floor(maxRadius)))}
            onChange={(e) => setDraft(e.target.value)}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
          />
          <input
            type="number"
            aria-label={t("imageCornersLabel")}
            className={styles.number}
            min={0}
            max={Math.floor(maxRadius)}
            step={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
          />
        </div>
      </div>
      <div className={styles.cornersFoot}>
        {radius === undefined && <span className={styles.hint}>{t("imageCornersFollowing")}</span>}
        <button
          type="button"
          className={styles.follow}
          disabled={radius === undefined}
          onClick={() => onRadius(undefined)}
        >
          {t("imageCornersFollow")}
        </button>
      </div>
    </div>
  );
}
