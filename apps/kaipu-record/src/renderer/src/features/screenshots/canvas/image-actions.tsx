import React, { useEffect, useId, useRef, useState } from "react";
import { Crop, Move, RotateCcw, SquareRoundCorner } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import styles from "./image-actions.module.css";

/** What the actions need to know about the selected image. */
export interface ImageActionsProps {
  /** `bar` floats over the image (dark pill); `panel` sits in the Tool tab. */
  variant: "bar" | "panel";
  /** The selected image: the Corners panel and its typed draft belong to one image, never the next. */
  imageId: string;
  /** There is a crop to remove: Reset is disabled without one. */
  hasCrop: boolean;
  /** Crop mode is open on this image: Crop is the checked mode (the Tool tab keeps the actions). */
  cropping?: boolean;
  /** This image's own corner radius in SOURCE px; absent = it follows the Beautify slider. */
  radius?: number;
  /** What the Beautify slider gives this image, in source px: shown while it follows. */
  followRadius: number;
  /** The largest useful radius, in source px: half the shorter visible side. */
  maxRadius: number;
  /** The Crop mode: the same crop mode a double-click on the image opens. */
  onCrop(): void;
  /** The Move mode: leave crop mode, exactly like its Done button. */
  onMove(): void;
  /** Reset: remove this image's crop (one undo step). */
  onResetCrop(): void;
  /** Corners: set this image's own radius, or `undefined` to follow the slider again. */
  onRadius(radius: number | undefined): void;
}

/**
 * Move | Crop, Corners and Reset for one selected image, the base or an added one (NIW2-876).
 * One component, two homes: the floating bar over the image and the Tool tab (spec
 * "Interaction").
 *
 * Move | Crop is a two-option mode control (a radio group), Move by default: the active mode is
 * the one segment in the accent, so Crop never reads as "you are cropping" while you are not.
 * Choosing Crop enters crop mode, choosing Move leaves it, like Done.
 *
 * Corners opens a small control under the buttons (inline in the Tool tab): a slider and a
 * number field in source px, and "Follow slider" to give the image back to the Beautify
 * slider. A drag of the slider is one change, committed when it is released, so it is one
 * undo step rather than one per pixel.
 */
export function ImageActions(props: ImageActionsProps): React.JSX.Element {
  // Keyed by image so an open Corners panel and an uncommitted draft cannot cross to the next selection.
  return <ImageActionsBody key={props.imageId} {...props} />;
}

function ImageActionsBody({
  variant,
  hasCrop,
  cropping = false,
  radius,
  followRadius,
  maxRadius,
  onCrop,
  onMove,
  onResetCrop,
  onRadius,
}: ImageActionsProps): React.JSX.Element {
  const t = useTranslations("screenshots");
  const [cornersOpen, setCornersOpen] = useState(false);
  const panelId = useId();
  const moveRef = useRef<HTMLButtonElement>(null);
  const cropRef = useRef<HTMLButtonElement>(null);
  // Choosing the mode that is already active does nothing: Move is "leave crop mode", and with
  // no crop mode open there is nothing to leave.
  const choose = (mode: "move" | "crop") => (): void => {
    if (mode === "crop" && !cropping) onCrop();
    else if (mode === "move" && cropping) onMove();
  };
  // A radio group is one tab stop; the arrow keys move the choice, as the native radios do.
  const onModeKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      choose("crop")();
      cropRef.current?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      choose("move")();
      moveRef.current?.focus();
    }
  };
  return (
    <div
      className={`${styles.actions} ${variant === "bar" ? styles.bar : styles.panel}`}
      data-variant={variant}
      // The Tool tab's copy is usable in crop mode: the page's click-away leaves it alone.
      {...(variant === "panel" ? { "data-keeps-crop-mode": "" } : {})}
    >
      <div className={styles.row} role="group" aria-label={t("imageActionsAria")}>
        <div
          className={styles.modes}
          role="radiogroup"
          aria-label={t("imageActionModeAria")}
          onKeyDown={onModeKey}
        >
          <button
            type="button"
            ref={moveRef}
            role="radio"
            className={styles.segment}
            title={t("imageActionMoveTitle")}
            aria-checked={!cropping}
            tabIndex={cropping ? -1 : 0}
            onClick={choose("move")}
          >
            <Move size={13} aria-hidden />
            {t("imageActionMove")}
          </button>
          <button
            type="button"
            ref={cropRef}
            role="radio"
            className={styles.segment}
            title={t("imageActionCropTitle")}
            aria-checked={cropping}
            tabIndex={cropping ? 0 : -1}
            onClick={choose("crop")}
          >
            <Crop size={13} aria-hidden />
            {t("imageActionCrop")}
          </button>
        </div>
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
