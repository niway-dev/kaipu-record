import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { backgroundCss, frameRadius, shadowCss, type BeautifyState } from "./backgrounds";
import type { CropRect, NormalizedRect } from "../annotations/scene";
import { hasExtents, type Extents } from "../annotations/canvas-geometry";
import { viewTransform } from "../canvas/viewport";
import styles from "./beautified-frame.module.css";

/**
 * A base that was cropped or resized (NIW2-853), as the live frame draws it. All of it in the
 * px and units of the page's own measure of the shot.
 */
export interface BaseFrameView {
  /** What shows of the base: its visible rect, base-normalized (the world's units). */
  visible: NormalizedRect;
  /** The window of the whole asset that shows, 0–1 of it. Undefined = all of it. */
  crop?: CropRect;
  /** The base's own corner radius in DISPLAY px. Undefined = follows `beautify.radius`. */
  radius?: number;
  /** The anchor image's layout size, display px (what the editor measures; it never moves). */
  shot: { w: number; h: number };
}

/** `calc(100% + 30px)` / `calc(100% - 30px)`: a valid sum whichever way the offset points. */
const calcOver = (px: number): string =>
  px >= 0 ? `calc(100% + ${px}px)` : `calc(100% - ${-px}px)`;

/**
 * Margins that make the anchor's margin box the visible rect: the frame lays out around
 * the box, so it wraps what shows. A rect past the anchor gives positive margins.
 */
function baseWrapMargins(b: BaseFrameView): React.CSSProperties {
  const { visible: v, shot } = b;
  return {
    marginLeft: `${-v.x * shot.w}px`,
    marginRight: `${-(1 - v.x - v.w) * shot.w}px`,
    marginTop: `${-v.y * shot.h}px`,
    marginBottom: `${-(1 - v.y - v.h) * shot.h}px`,
  };
}

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
  base,
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
  /**
   * A cropped or resized base (canvas mode). The original image stays in the layout as an
   * invisible anchor, so the fit and the measured size do not move; the visible part is drawn
   * on top at its own rect and the frame wraps THAT, as the export does. Undefined = a base
   * at its natural place and size, drawn as it always was.
   */
  base?: BaseFrameView;
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

  // The height bound for the shot, as a length: its own percent height has no definite parent.
  // Un-windowed it is what the frame's own `max-height: 100%` leaves after the padding (the
  // extents and a base's offset cancel out: both the frame and its content move by the same
  // amount). Windowed, the frame is recomposed from the shot's constant size, so the bound is
  // that size: it must not shrink when the padding slider grows the frame.
  const shotMaxH = windowed
    ? base
      ? base.shot.h
      : measured.h - 2 * measured.pad - measured.extH
    : `calc(100cqh - ${2 * beautify.padding}px)`;
  const frameStyle: React.CSSProperties = {
    "--shot-max-h": typeof shotMaxH === "number" ? `${shotMaxH}px` : shotMaxH,
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
    // A cropped or resized base moves the same way: the frame wraps the visible part, so its
    // maximum also changes by what the anchor image has that the visible part does not (or
    // the other way round), and the anchor keeps the size it would have had.
    ...(ext || base
      ? {
          flexShrink: 0,
          maxWidth: calcOver(
            (ext ? ext.left + ext.right : 0) - (base ? base.shot.w * (1 - base.visible.w) : 0),
          ),
          maxHeight: calcOver(
            (ext ? ext.top + ext.bottom : 0) - (base ? base.shot.h * (1 - base.visible.h) : 0),
          ),
        }
      : {}),
  } as React.CSSProperties;
  const transform = viewTransform({ zoom, panX: pan?.x ?? 0, panY: pan?.y ?? 0 });
  const inner = (
    <>
      {boxLayer}
      <div className={styles.shotWrap} style={base ? baseWrapMargins(base) : undefined}>
        <img
          ref={imgRef}
          src={src}
          alt={t("imageAlt")}
          className={styles.shot}
          style={
            base
              ? { opacity: 0 }
              : { borderRadius: `${beautify.radius}px`, boxShadow: shadowCss(beautify.shadow) }
          }
          onLoad={onImageLoad}
        />
        {base && (
          <div
            data-testid="base-view"
            className={styles.baseView}
            style={{
              left: `${base.visible.x * 100}%`,
              top: `${base.visible.y * 100}%`,
              width: `${base.visible.w * 100}%`,
              height: `${base.visible.h * 100}%`,
              borderRadius: `${base.radius ?? beautify.radius}px`,
              boxShadow: shadowCss(beautify.shadow),
            }}
          >
            <img
              src={src}
              alt=""
              draggable={false}
              className={styles.baseViewImage}
              style={{
                left: `${-((base.crop?.x ?? 0) / (base.crop?.w ?? 1)) * 100}%`,
                top: `${-((base.crop?.y ?? 0) / (base.crop?.h ?? 1)) * 100}%`,
                width: `${100 / (base.crop?.w ?? 1)}%`,
                height: `${100 / (base.crop?.h ?? 1)}%`,
              }}
            />
          </div>
        )}
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
    // A cropped or resized base: its visible size is known from the anchor's (constant) size,
    // so a base that changed since the measure still lays out right.
    const shotW = base
      ? base.shot.w * base.visible.w
      : measured.w - 2 * measured.pad - measured.extW;
    const shotH = base
      ? base.shot.h * base.visible.h
      : measured.h - 2 * measured.pad - measured.extH;
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
