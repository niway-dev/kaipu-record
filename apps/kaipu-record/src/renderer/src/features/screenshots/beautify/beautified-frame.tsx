import React, { useState } from "react";
import { backgroundCss, frameRadius, shadowCss, type BeautifyState } from "./backgrounds";
import type { CropRect } from "../annotations/scene";
import styles from "./beautified-frame.module.css";

/** The screenshot framed by the current beautify settings, with an optional
 *  overlay (the annotation layer) positioned exactly over the image. */
export function BeautifiedFrame({
  src,
  beautify,
  overlay,
  imgRef,
  zoom = 1,
  crop,
  onImageLoad,
}: {
  src: string;
  beautify: BeautifyState;
  overlay?: React.ReactNode;
  imgRef?: React.Ref<HTMLImageElement>;
  /**
   * View magnification. Scales the frame visually; the annotation layer keeps
   * measuring its layout size, so annotations stay aligned at any zoom. Export
   * reads the image's layout pixels, so zoom is view-only (never bakes in).
   */
  zoom?: number;
  /** Applied crop window (normalized). Undefined = full image. */
  crop?: CropRect;
  /** Fires once the shot has loaded and laid out (export needs its displayed size). */
  onImageLoad?: () => void;
}): React.JSX.Element {
  const [aspect, setAspect] = useState<number | null>(null); // natural W/H

  const windowed = crop != null && aspect != null;
  // Viewport aspect = cropped pixel aspect = (crop.w*W)/(crop.h*H) = (crop.w*aspect)/crop.h.
  const viewportAspect = windowed ? (crop.w * aspect) / crop.h : undefined;
  const planeStyle: React.CSSProperties = windowed
    ? {
        position: "absolute",
        width: `${100 / crop.w}%`,
        height: `${100 / crop.h}%`,
        left: `${(-100 * crop.x) / crop.w}%`,
        top: `${(-100 * crop.y) / crop.h}%`,
      }
    : { position: "relative" };

  return (
    <div
      className={styles.frame}
      style={{
        background: backgroundCss(beautify.bg),
        padding: `${beautify.padding}px`,
        borderRadius: `${frameRadius(beautify.bg, beautify.radius)}px`,
        transform: zoom === 1 ? undefined : `scale(${zoom})`,
      }}
    >
      <div
        className={windowed ? styles.viewport : styles.shotWrap}
        style={windowed ? { aspectRatio: `${viewportAspect}` } : undefined}
      >
        <div className={styles.plane} style={planeStyle}>
          <img
            ref={imgRef}
            src={src}
            alt="Screenshot"
            className={styles.shot}
            style={{ borderRadius: `${beautify.radius}px`, boxShadow: shadowCss(beautify.shadow) }}
            onLoad={(e) => {
              const el = e.currentTarget;
              if (el.naturalHeight > 0) setAspect(el.naturalWidth / el.naturalHeight);
              onImageLoad?.();
            }}
          />
          {overlay}
        </div>
      </div>
    </div>
  );
}
