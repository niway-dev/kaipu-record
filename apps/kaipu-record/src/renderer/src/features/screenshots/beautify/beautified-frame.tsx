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
  // The frame's border-box AND the padding it was measured at. We derive the shot's
  // displayed size (border-box − 2·padding) so the windowed frame can be recomposed
  // at the *current* padding — see the windowed branch.
  const [measured, setMeasured] = useState<{ w: number; h: number; pad: number } | null>(null);

  const windowed = crop != null && measured != null;

  // Read the live padding without re-subscribing the observer each slider step: a
  // padding change resizes the frame, so the ResizeObserver fires and re-measures
  // anyway, reading the fresh padding through this ref.
  const padRef = useRef(beautify.padding);
  padRef.current = beautify.padding;

  // Measure the frame's natural border-box while un-windowed, so the crop window can be
  // expressed in real px. Windowing renders the frame at a derived size and pans it via
  // transform (the shot's layout size — and thus the export scale — stays constant).
  // Sampling while windowed would re-measure the forced size, so only observe un-windowed.
  useEffect(() => {
    const el = frameRef.current;
    if (!el || windowed) return;
    const measure = (): void =>
      setMeasured({ w: el.offsetWidth, h: el.offsetHeight, pad: padRef.current });
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
    // Recompose the frame from the shot's (constant) displayed size + the CURRENT
    // padding, instead of freezing the measured border-box. The shot keeps its
    // size — so the export scale stays constant — while moving the padding slider
    // grows/shrinks the frame live, exactly as the export composes it (fullW =
    // shot + 2·pad). Freezing the border-box let the shot resize inside a stale
    // frame, so the crop window then selected different content than the export.
    const shotW = measured.w - 2 * measured.pad;
    const shotH = measured.h - 2 * measured.pad;
    const frameW = shotW + 2 * beautify.padding;
    const frameH = shotH + 2 * beautify.padding;
    const winW = crop.w * frameW;
    const winH = crop.h * frameH;
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
            width: `${frameW}px`,
            height: `${frameH}px`,
            maxWidth: "none",
            maxHeight: "none",
            transform: `translate(${-crop.x * frameW}px, ${-crop.y * frameH}px)`,
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
