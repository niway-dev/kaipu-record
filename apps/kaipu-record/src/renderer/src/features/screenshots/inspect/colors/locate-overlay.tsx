import React, { useCallback, useEffect, useRef } from "react";
import type { CropRect, NormalizedRect } from "../../annotations/scene";
import type { LocatedImage } from "./colors-client";
import { tagPlacement } from "./locate-tag";
import styles from "./colors.module.css";

/**
 * The locate highlight: an image-sized canvas over the shot (inside the frame's overlay slot,
 * so zoom, pan and a crop window move and clip it with the image), dim everywhere except the
 * located pixels. Pointer events pass through. `label` is the tag under the largest area of
 * the color ("#FDFDFD · 2 AREAS · 17.5% OF THE IMAGE"); it is a sibling of the canvas, not
 * inside it, so the canvas keeps the image's own parent.
 *
 * `base` is a base that was cropped, resized or moved (the live frame's view of it): the canvas
 * is the WHOLE asset, so it is laid out where the asset sits and clipped to what shows, the way
 * the frame draws the base itself. Without it the base is at its natural place and size.
 */
export function LocateOverlay({
  image,
  label = null,
  base,
}: {
  image: LocatedImage | null;
  label?: string | null;
  base?: { visible: NormalizedRect; crop?: CropRect };
}): React.JSX.Element | null {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // Release the backing store (59 MiB at 5K) as soon as the canvas leaves the page, which is
  // when the highlight is cleared: a callback ref still holds the node at that moment.
  const attach = useCallback((canvas: HTMLCanvasElement | null): void => {
    const previous = ref.current;
    if (!canvas && previous) {
      previous.width = 0;
      previous.height = 0;
    }
    ref.current = canvas;
  }, []);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (image.bitmap) ctx.drawImage(image.bitmap, 0, 0);
    else {
      const data = ctx.createImageData(image.width, image.height);
      data.data.set(image.pixels);
      ctx.putImageData(data, 0, 0);
    }
  }, [image]);
  if (!image) return null;
  const placed =
    label && image.bounds ? tagPlacement(image.bounds, image.width, image.height) : null;
  const marks = (
    <>
      <canvas
        ref={attach}
        className={styles.overlay}
        width={image.width}
        height={image.height}
        data-testid="inspect-locate"
        data-matched={image.matched}
        aria-hidden
      />
      {placed && (
        <span
          className={`${styles.locateTag} ${placed.above ? styles.locateTagAbove : ""}`}
          style={{ left: `${placed.left}%`, top: `${placed.top}%` }}
          data-testid="inspect-locate-tag"
        >
          {label}
        </span>
      )}
    </>
  );
  if (!base) return marks;
  const { visible: v, crop: c } = base;
  return (
    <div
      className={styles.locateView}
      data-testid="inspect-locate-view"
      style={{
        left: `${v.x * 100}%`,
        top: `${v.y * 100}%`,
        width: `${v.w * 100}%`,
        height: `${v.h * 100}%`,
      }}
    >
      <div
        className={styles.locateAsset}
        data-testid="inspect-locate-asset"
        style={{
          left: `${-((c?.x ?? 0) / (c?.w ?? 1)) * 100}%`,
          top: `${-((c?.y ?? 0) / (c?.h ?? 1)) * 100}%`,
          width: `${100 / (c?.w ?? 1)}%`,
          height: `${100 / (c?.h ?? 1)}%`,
        }}
      >
        {marks}
      </div>
    </div>
  );
}
