import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { backgroundCss, frameRadius, shadowCss, type BeautifyState } from "./backgrounds";
import type { CropRect } from "../annotations/scene";
import { hasExtents, type Extents } from "../annotations/canvas-geometry";
import { viewTransform } from "../canvas/viewport";
import styles from "./beautified-frame.module.css";

/** The screenshot framed by the current beautify settings, with an optional
 *  overlay (the annotation layer) positioned exactly over the image. */
export function BeautifiedFrame({
  src,
  beautify,
  overlay,
  frameOverlay,
  boxLayer,
  imgRef,
  zoom = 1,
  pan,
  extents,
  crop,
  windowChip,
  onWindowDoubleClick,
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
  /**
   * Canvas mode (NIW2-711): the export box. It fills the frame's border-box, which IS the
   * exported rectangle (content box plus padding), and sits under the shot. Not rendered
   * when the frame is windowed by an export frame: the window replaces the box.
   */
  boxLayer?: React.ReactNode;
  imgRef?: React.Ref<HTMLImageElement>;
  /**
   * View magnification. Scales the frame visually; the annotation layer keeps
   * measuring its layout size, so annotations stay aligned at any zoom. Export
   * reads the image's layout pixels, so zoom is view-only (never bakes in).
   */
  zoom?: number;
  /**
   * Canvas mode (NIW2-698): the view's pan in screen px, applied with `zoom` as one
   * transform. View-only, like zoom. Undefined = the classic zoom-only transform.
   */
  pan?: { x: number; y: number };
  /**
   * Canvas mode: how far the content box sticks out past each side of the shot, in DISPLAY
   * px. The frame's padding becomes `padding + extent` per side, so the background covers
   * the whole content box; the shot keeps its layout size (the frame may grow past the
   * canvas by the extents instead of squeezing it), so the export scale does not move.
   * Undefined or all zero = today's frame.
   */
  extents?: Extents;
  /** Applied crop window, normalized 0–1 of the whole frame. Undefined = full frame. */
  crop?: CropRect;
  /**
   * The "Cropped" chip (NIW2-759): drawn above the cropped window's top-left corner, visible
   * while the pointer is over it. Only rendered while `crop` windows the frame.
   */
  windowChip?: React.ReactNode;
  /** A double-click on the cropped window (not on the chip). Only while `crop` windows the frame. */
  onWindowDoubleClick?: () => void;
  /** Fires once the shot has loaded and laid out (export needs its displayed size). */
  onImageLoad?: () => void;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const frameRef = useRef<HTMLDivElement>(null);
  // The frame's border-box AND the padding it was measured at. We derive the shot's
  // displayed size (border-box − 2·padding) so the windowed frame can be recomposed
  // at the *current* padding — see the windowed branch.
  // `extW`/`extH` are the extents (left + right, top + bottom) it was measured at, the
  // same way: they are part of the border-box, not of the shot.
  const [measured, setMeasured] = useState<{
    w: number;
    h: number;
    pad: number;
    extW: number;
    extH: number;
  } | null>(null);

  const windowed = crop != null && measured != null;

  // Read the live padding without re-subscribing the observer each slider step: a
  // padding change resizes the frame, so the ResizeObserver fires and re-measures
  // anyway, reading the fresh padding through this ref.
  const padRef = useRef(beautify.padding);
  padRef.current = beautify.padding;

  const ext = extents && hasExtents(extents) ? extents : undefined;
  const extRef = useRef(ext);
  extRef.current = ext;

  // Measure the frame's natural border-box while un-windowed, so the crop window can be
  // expressed in real px. Windowing renders the frame at a derived size and pans it via
  // transform (the shot's layout size — and thus the export scale — stays constant).
  // Sampling while windowed would re-measure the forced size, so only observe un-windowed.
  useEffect(() => {
    const el = frameRef.current;
    if (!el || windowed) return;
    const measure = (): void =>
      setMeasured({
        w: el.offsetWidth,
        h: el.offsetHeight,
        pad: padRef.current,
        extW: (extRef.current?.left ?? 0) + (extRef.current?.right ?? 0),
        extH: (extRef.current?.top ?? 0) + (extRef.current?.bottom ?? 0),
      });
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    measure();
    return () => obs.disconnect();
  }, [windowed]);

  const frameStyle: React.CSSProperties = {
    background: backgroundCss(beautify.bg),
    padding: ext
      ? `${beautify.padding + ext.top}px ${beautify.padding + ext.right}px ${beautify.padding + ext.bottom}px ${beautify.padding + ext.left}px`
      : `${beautify.padding}px`,
    borderRadius: `${frameRadius(beautify.bg, beautify.radius)}px`,
    // The extents live inside the frame's border-box, so let it outgrow its container by
    // exactly that much: the shot then fits the canvas as it does without extents.
    // `flexShrink: 0` matters: the frame is a flex item of the canvas, and with the default
    // shrink a capture that fills the width would be squeezed back to the container width,
    // so the shot would get smaller (and the export scale change) as the extents grow.
    ...(ext
      ? {
          flexShrink: 0,
          maxWidth: `calc(100% + ${ext.left + ext.right}px)`,
          maxHeight: `calc(100% + ${ext.top + ext.bottom}px)`,
        }
      : {}),
  };
  const transform = viewTransform({ zoom, panX: pan?.x ?? 0, panY: pan?.y ?? 0 });
  // Canvas mode with nothing behind the content: the union box (not the padding ring)
  // gets a neutral white under the shot, as the export does.
  const boxFill =
    ext && beautify.bg === "none" ? (
      <div
        className={styles.boxFill}
        style={{ inset: `${beautify.padding}px` }}
        data-testid="canvas-box-fill"
        aria-hidden
      />
    ) : null;

  const inner = (
    <>
      {boxLayer}
      {boxFill}
      <div className={styles.shotWrap}>
        <img
          ref={imgRef}
          src={src}
          alt={t("imageAlt")}
          className={styles.shot}
          style={{ borderRadius: `${beautify.radius}px`, boxShadow: shadowCss(beautify.shadow) }}
          onLoad={onImageLoad}
        />
        {overlay}
      </div>
    </>
  );

  if (windowed) {
    // Recompose the frame from the shot's (constant) displayed size + the CURRENT
    // padding, instead of freezing the measured border-box. The shot keeps its
    // size — so the export scale stays constant — while moving the padding slider
    // grows/shrinks the frame live, exactly as the export composes it (fullW =
    // shot + 2·pad). Freezing the border-box let the shot resize inside a stale
    // frame, so the crop window then selected different content than the export.
    const shotW = measured.w - 2 * measured.pad - measured.extW;
    const shotH = measured.h - 2 * measured.pad - measured.extH;
    const frameW = shotW + 2 * beautify.padding + (ext ? ext.left + ext.right : 0);
    const frameH = shotH + 2 * beautify.padding + (ext ? ext.top + ext.bottom : 0);
    const winW = crop.w * frameW;
    const winH = crop.h * frameH;
    return (
      <div
        className={styles.windowRoot}
        style={{ width: `${winW}px`, height: `${winH}px`, transform }}
        onDoubleClick={onWindowDoubleClick}
      >
        <div className={styles.viewport} style={{ width: `${winW}px`, height: `${winH}px` }}>
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
        {windowChip && <div className={styles.chipSlot}>{windowChip}</div>}
      </div>
    );
  }

  return (
    <div
      ref={frameRef}
      className={pan ? `${styles.frame} ${styles.panned}` : styles.frame}
      style={{ ...frameStyle, transform }}
    >
      {inner}
      {frameOverlay}
    </div>
  );
}
