import React, { useEffect, useRef, useState } from "react";
import { backgroundCss, frameRadius, shadowCss, type BeautifyState } from "./backgrounds";
import type { CropRect } from "../annotations/scene";
import styles from "./beautified-frame.module.css";

/** The screenshot framed by the current beautify settings, with an optional
 *  overlay (the annotation layer) positioned exactly over the image. */
export function BeautifiedFrame({
  src,
  beautify,
  overlay,
  frameOverlay,
  imgRef,
  zoom = 1,
  crop,
  onImageLoad,
}: {
  src: string;
  beautify: BeautifyState;
  overlay?: React.ReactNode;
  /**
   * A frame-level overlay (the crop tool) covering the whole frame — background,
   * padding and shot. Rendered only while the crop is edited un-windowed.
   */
  frameOverlay?: React.ReactNode;
  imgRef?: React.Ref<HTMLImageElement>;
  /**
   * View magnification. Scales the frame visually; the annotation layer keeps
   * measuring its layout size, so annotations stay aligned at any zoom. Export
   * reads the image's layout pixels, so zoom is view-only (never bakes in).
   */
  zoom?: number;
  /** Applied crop window, normalized 0–1 of the whole frame. Undefined = full frame. */
  crop?: CropRect;
  /** Fires once the shot has loaded and laid out (export needs its displayed size). */
  onImageLoad?: () => void;
}): React.JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState<{ w: number; h: number } | null>(null);

  const windowed = crop != null && frameSize != null;

  // Measure the frame's natural border-box while un-windowed, so the crop window can be
  // expressed in real px. Windowing renders the frame at this fixed size and pans it via
  // transform (layout size unchanged), so the shot's clientWidth — and thus the export
  // scale — stays identical cropped or not. Sampling while windowed would re-measure the
  // fixed size, so only observe un-windowed.
  useEffect(() => {
    const el = frameRef.current;
    if (!el || windowed) return;
    const measure = (): void => setFrameSize({ w: el.offsetWidth, h: el.offsetHeight });
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    measure();
    return () => obs.disconnect();
  }, [windowed]);

  const frameStyle: React.CSSProperties = {
    background: backgroundCss(beautify.bg),
    padding: `${beautify.padding}px`,
    borderRadius: `${frameRadius(beautify.bg, beautify.radius)}px`,
  };

  const inner = (
    <div className={styles.shotWrap}>
      <img
        ref={imgRef}
        src={src}
        alt="Screenshot"
        className={styles.shot}
        style={{ borderRadius: `${beautify.radius}px`, boxShadow: shadowCss(beautify.shadow) }}
        onLoad={onImageLoad}
      />
      {overlay}
    </div>
  );

  if (windowed) {
    // Show only the crop sub-rect: the viewport clips to the window (natural frame px),
    // and the frame — rendered at its fixed natural size — is panned so the crop's
    // top-left sits at the viewport origin. A uniform pan (no re-layout) keeps padding/
    // shadow proportions pixel-identical to the export (compose-then-window).
    const winW = crop.w * frameSize.w;
    const winH = crop.h * frameSize.h;
    return (
      <div
        className={styles.viewport}
        style={{
          width: `${winW}px`,
          height: `${winH}px`,
          transform: zoom === 1 ? undefined : `scale(${zoom})`,
        }}
      >
        <div
          ref={frameRef}
          className={styles.frame}
          style={{
            ...frameStyle,
            position: "absolute",
            top: 0,
            left: 0,
            width: `${frameSize.w}px`,
            height: `${frameSize.h}px`,
            maxWidth: "none",
            maxHeight: "none",
            transform: `translate(${-crop.x * frameSize.w}px, ${-crop.y * frameSize.h}px)`,
          }}
        >
          {inner}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={frameRef}
      className={styles.frame}
      style={{ ...frameStyle, transform: zoom === 1 ? undefined : `scale(${zoom})` }}
    >
      {inner}
      {frameOverlay}
    </div>
  );
}
