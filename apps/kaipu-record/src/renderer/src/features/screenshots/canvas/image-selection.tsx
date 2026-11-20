import React from "react";
import { useTranslations } from "@kaipu/i18n";
import type { CropRect } from "../annotations/scene";
import type { GapMeasure } from "./image-gap";
import styles from "./image-selection.module.css";

/** A rectangle in the annotation layer's own px (the shot's displayed size). */
export interface LayerRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The eight positions of the mock's handles, as fractions of the frame. */
const HANDLE_AT: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [1, 0.5],
  [1, 1],
  [0.5, 1],
  [0, 1],
  [0, 0.5],
];

/**
 * The part of an image's source that shows, in whole source pixels: its crop window of the
 * asset, or the whole asset without one. The tag reads it next to the full size so a cropped
 * image never shows a number that disagrees with what is on screen (NIW2-876).
 */
export function visibleSourceSize(
  pixelWidth: number,
  pixelHeight: number,
  crop?: CropRect,
): { w: number; h: number } {
  if (!crop) return { w: pixelWidth, h: pixelHeight };
  return { w: Math.round(crop.w * pixelWidth), h: Math.round(crop.h * pixelHeight) };
}

/**
 * What a selected added image wears in canvas mode (mock A4), drawn over the annotation layer:
 * the white halo hugging the accent frame (the frame itself is the image's own outline), the
 * handles, a "drag to move" tag with the image's pixel size, and the gap to its nearest
 * neighbour on each axis.
 *
 * The layer is scaled by the canvas zoom; every line, handle and label reads `--canvas-zoom`
 * (written on the canvas element) to stay one screen size at any zoom.
 *
 * The handles are the mock's. The four corners resize the image with its aspect ratio locked
 * (hit-tested by the annotation layer, not here); the four edge handles are drawn only, so a
 * press on one drags the image.
 *
 * `gaps` are in world units (1 = one source px); `unit` is layer px per world unit.
 */
export function ImageSelection({
  rect,
  pixelWidth,
  pixelHeight,
  crop,
  gaps,
  unit,
  justAdded = false,
  movable = true,
}: {
  rect: LayerRect;
  pixelWidth: number;
  pixelHeight: number;
  /** The image's crop window of its source: the tag then reads the visible size of the total. */
  crop?: CropRect;
  gaps: readonly GapMeasure[];
  unit: number;
  /** Just added and not yet moved: the tag reads "just added" and drops the pixel size. */
  justAdded?: boolean;
  /**
   * False when a press on the image does not drag it (the base in Inspect, where the image is
   * read, not edited): the tag then omits "drag to move" instead of advertising a drag that
   * does nothing.
   */
  movable?: boolean;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const visible = visibleSourceSize(pixelWidth, pixelHeight, crop);
  return (
    <>
      <div
        className={styles.frame}
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
        data-testid="image-selection"
        aria-hidden
      >
        <div className={styles.haloOut} />
        <div className={styles.haloIn} />
        {HANDLE_AT.map(([fx, fy], i) => (
          <div
            key={i}
            className={styles.handle}
            data-testid="image-handle"
            style={{ left: `${fx * 100}%`, top: `${fy * 100}%` }}
          />
        ))}
        <div
          className={styles.tag}
          data-testid="image-tag"
          {...(justAdded ? { "data-just-added": "" } : {})}
        >
          {justAdded ? (
            <span className={styles.tagLabel}>{t("justAddedDragToPlace")}</span>
          ) : (
            <>
              {movable && <span className={styles.tagLabel}>{t("dragToMove")}</span>}
              {crop ? (
                <span>
                  {t("imageSizeShowing", {
                    visibleW: visible.w,
                    visibleH: visible.h,
                    w: pixelWidth,
                    h: pixelHeight,
                  })}
                </span>
              ) : (
                <span>
                  {pixelWidth} × {pixelHeight} px
                </span>
              )}
            </>
          )}
        </div>
      </div>
      {gaps.map((g) => (
        <GapLine key={g.axis} gap={g} unit={unit} />
      ))}
    </>
  );
}

/** The dashed line across one gap and its label, at the middle of the line. */
function GapLine({ gap, unit }: { gap: GapMeasure; unit: number }): React.JSX.Element {
  const horizontal = gap.axis === "x";
  const along = Math.min(gap.from, gap.to) * unit;
  const length = Math.abs(gap.to - gap.from) * unit;
  const across = gap.at * unit;
  return (
    <div
      className={horizontal ? styles.gapH : styles.gapV}
      data-testid="image-gap"
      data-axis={gap.axis}
      style={
        horizontal
          ? { left: along, top: across, width: length }
          : { left: across, top: along, height: length }
      }
      aria-hidden
    >
      <span className={styles.gapLabel} data-testid="image-gap-label">
        {gap.px} px
      </span>
    </div>
  );
}
