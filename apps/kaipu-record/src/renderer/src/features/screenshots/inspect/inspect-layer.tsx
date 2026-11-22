import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import { MAX_TOLERANCE, MIN_TOLERANCE } from "./pixel-run";
import { LOUPE_RADIUS, type InspectController, type InspectRun } from "./use-inspect";
import { RULER_HALO_PX, RULER_STROKE_PX, RULER_TICK_PX } from "../ruler-line";
import styles from "./inspect.module.css";

/** Gap between the pointer and the HUD, per axis, in CSS px. */
const HUD_OFFSET = 22;
// Until the HUD is measured: a loupe (124), a chip and a line or two.
const HUD_WIDTH = 200;
const HUD_HEIGHT = 190;
const LOUPE_SIDE = LOUPE_RADIUS * 2 + 1;
/** Half-length of the ticks across each end of the ruler, in CSS px (shared with a pinned measure). */
const TICK = RULER_TICK_PX;
/** A press that moves less than this, in CSS px, is a click (pins the run), not a drag. */
const CLICK_SLOP = 4;
const TOLERANCE_CARD_WIDTH = 150;
/** The card's height (label row + bar + padding), for keeping it inside the layer. */
const TOLERANCE_CARD_HEIGHT = 44;

/** The ruler under the cursor: a line between the run's outer edges, end ticks, the length. */
function Ruler({
  run,
  origin,
}: {
  run: InspectRun;
  origin: { left: number; top: number };
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const x1 = run.line.x1 - origin.left;
  const y1 = run.line.y1 - origin.top;
  const x2 = run.line.x2 - origin.left;
  const y2 = run.line.y2 - origin.top;
  const horizontal = run.run.axis === "x";
  const ticks = horizontal
    ? [
        [x1, y1 - TICK, x1, y1 + TICK],
        [x2, y2 - TICK, x2, y2 + TICK],
      ]
    : [
        [x1 - TICK, y1, x1 + TICK, y1],
        [x2 - TICK, y2, x2 + TICK, y2],
      ];
  const segments = [[x1, y1, x2, y2], ...ticks];
  const labelStyle = horizontal
    ? { left: (x1 + x2) / 2, top: y1 - TICK - 5 }
    : { left: x1 + TICK + 7, top: (y1 + y2) / 2 };
  return (
    <>
      <svg className={styles.ruler} data-testid="inspect-ruler" aria-hidden="true">
        {segments.map(([ax, ay, bx, by], i) => (
          <line
            key={`h${i}`}
            className={styles.rulerHalo}
            strokeWidth={RULER_HALO_PX}
            x1={ax}
            y1={ay}
            x2={bx}
            y2={by}
          />
        ))}
        {segments.map(([ax, ay, bx, by], i) => (
          <line
            key={i}
            className={styles.rulerLine}
            strokeWidth={RULER_STROKE_PX}
            x1={ax}
            y1={ay}
            x2={bx}
            y2={by}
          />
        ))}
      </svg>
      <span
        {...uiArea("editorImage.inspectRun")}
        className={`${styles.rulerLabel} ${horizontal ? styles.rulerLabelH : styles.rulerLabelV}`}
        style={labelStyle}
        data-testid="inspect-ruler-length"
        data-axis={run.run.axis}
        data-outer={String(run.outer)}
        data-sub={run.outer ? t("inspectOuterTag") : undefined}
      >
        {run.length} px
      </span>
    </>
  );
}

/** Draw the loupe pixels unsmoothed; CSS scales the small canvas up with pixelated rendering. */
function Loupe({ pixels }: { pixels: Uint8ClampedArray | null }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx || !pixels) return;
    ctx.imageSmoothingEnabled = false;
    const image = ctx.createImageData(LOUPE_SIDE, LOUPE_SIDE);
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);
  }, [pixels]);
  return (
    <div className={styles.loupeFrame}>
      <canvas
        ref={ref}
        className={styles.loupe}
        width={LOUPE_SIDE}
        height={LOUPE_SIDE}
        data-testid="inspect-loupe"
        data-smoothing="off"
      />
      <span className={styles.loupeGrid} />
      <span className={styles.loupeCentre} />
    </div>
  );
}

type Point = { clientX: number; clientY: number };

/**
 * Where the HUD goes: right of and below the pointer, flipped per axis when its measured size
 * would leave the layer. The size is measured on mount and on every resize; the constants are the first guess.
 */
function useHudPlacement(layer: React.RefObject<HTMLDivElement | null>, at: Point) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: HUD_WIDTH, height: HUD_HEIGHT });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => {
      const width = el.offsetWidth || HUD_WIDTH;
      const height = el.offsetHeight || HUD_HEIGHT;
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
    // One observer per mount: the layer mounts the HUD only while there is a pointer, so its node
    // never changes underneath this effect.
  }, []);
  const rect = layer.current?.getBoundingClientRect();
  const width = rect?.width || Infinity;
  const height = rect?.height || Infinity;
  const x = at.clientX - (rect?.left ?? 0);
  const y = at.clientY - (rect?.top ?? 0);
  const flipX = x + HUD_OFFSET + size.width > width;
  const flipY = y + HUD_OFFSET + size.height > height;
  const left = Math.max(0, flipX ? x - HUD_OFFSET - size.width : x + HUD_OFFSET);
  const top = Math.max(0, flipY ? y - HUD_OFFSET - size.height : y + HUD_OFFSET);
  return { ref, left, top, flipX, flipY, x, y, width, height, hudWidth: size.width };
}

function Hud({
  inspect,
  layer,
}: {
  inspect: InspectController;
  layer: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element | null {
  const t = useTranslations("screenshots");
  const { hover, readout, run } = inspect;
  const { ref, left, top, flipX, flipY, x, y, width, height, hudWidth } = useHudPlacement(
    layer,
    hover ?? { clientX: 0, clientY: 0 },
  );
  if (!hover) return null;
  const tag = inspect.asCaptured
    ? t(hover.outOfGamut ? "inspectTagAsCapturedP3" : "inspectTagAsCaptured")
    : inspect.format.toUpperCase();
  // The tolerance card sits beside the pointer, on the side the HUD did not take (its measured
  // flip). Where that side has no room it goes past the HUD's far edge instead. A layer too
  // narrow for both keeps the card visible inside it, even over the HUD. Vertically it follows
  // the pointer, kept inside the layer, which clips.
  const besidePointer = flipX ? x + 12 : x - 12 - TOLERANCE_CARD_WIDTH;
  const pastHud = flipX ? left - 12 - TOLERANCE_CARD_WIDTH : left + hudWidth + 12;
  const toleranceLeft =
    besidePointer >= 0 && besidePointer + TOLERANCE_CARD_WIDTH <= width
      ? besidePointer
      : Math.min(Math.max(0, pastHud), Math.max(0, width - TOLERANCE_CARD_WIDTH));
  const toleranceTop = Math.min(
    Math.max(0, flipY ? y - 12 - TOLERANCE_CARD_HEIGHT : y + 12),
    height - TOLERANCE_CARD_HEIGHT,
  );
  const toleranceFill =
    ((inspect.tolerance - MIN_TOLERANCE) / (MAX_TOLERANCE - MIN_TOLERANCE)) * 100;
  return (
    <>
      <div
        ref={ref}
        {...uiArea("editorImage.inspectHud")}
        // "true" once the captured tile for this pixel is read: the gamut mark is final then.
        data-probed={hover.outOfGamut !== undefined}
        data-flip-x={String(flipX)}
        data-flip-y={String(flipY)}
        className={`${styles.hud} ${flipY ? styles.hudFlipY : ""}`}
        style={{ left, top }}
      >
        {inspect.loupeShown && <Loupe pixels={inspect.loupe} />}
        <div className={styles.chip}>
          <span
            className={`${styles.chipSwatch} ${inspect.copied ? styles.chipSwatchCopied : ""}`}
            style={
              inspect.copied
                ? undefined
                : {
                    background: `rgba(${hover.color.r}, ${hover.color.g}, ${hover.color.b}, ${hover.color.a / 255})`,
                  }
            }
            data-copied={inspect.copied ? "true" : undefined}
          >
            {inspect.copied && <Check size={13} strokeWidth={2.4} aria-hidden="true" />}
          </span>
          <span className={styles.chipText}>{readout ?? "…"}</span>
          <span className={styles.chipTag} data-testid="inspect-format-tag">
            {tag}
          </span>
          {hover.outOfGamut && <span className={styles.chipBadge}>{t("inspectGamutBadge")}</span>}
        </div>
        <span className={styles.coords}>
          {hover.x}, {hover.y}
        </span>
        {run && (
          <span className={styles.coords} data-testid="inspect-run-readout">
            {t(run.outer ? "inspectRunOuter" : "inspectRun", {
              length: run.length,
              tolerance: inspect.tolerance,
            })}
          </span>
        )}
        {hover.outOfGamut && (
          <span className={styles.gamut}>
            <span className={styles.gamutTitle}>{t("inspectOutOfSrgb")}</span>
            {!inspect.asCaptured && (
              <span>{t.rich("inspectOutOfSrgbBody", { b: (chunks) => <b>{chunks}</b> })}</span>
            )}
          </span>
        )}
      </div>
      {inspect.toleranceShown && (
        <div
          className={styles.toleranceCard}
          data-testid="inspect-tolerance-card"
          style={{
            left: toleranceLeft,
            top: toleranceTop,
          }}
        >
          <div className={styles.toleranceCardRow}>
            <span className={styles.toleranceCardLabel}>{t("inspectToleranceCard")}</span>
            <span className={styles.toleranceCardValue}>{inspect.tolerance}</span>
          </div>
          <div className={styles.toleranceCardTrack}>
            <div className={styles.toleranceCardFill} style={{ width: `${toleranceFill}%` }} />
          </div>
        </div>
      )}
    </>
  );
}

/** The pointer is over the layer but off the image: a hatched loupe and nothing to read. */
function EmptyHud({
  at,
  layer,
  loupe,
}: {
  at: Point;
  layer: React.RefObject<HTMLDivElement | null>;
  loupe: boolean;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const { ref, left, top, flipX, flipY } = useHudPlacement(layer, at);
  return (
    <div
      ref={ref}
      {...uiArea("editorImage.inspectEmpty")}
      data-flip-x={String(flipX)}
      data-flip-y={String(flipY)}
      className={`${styles.hud} ${flipY ? styles.hudFlipY : ""}`}
      style={{ left, top }}
    >
      {loupe && (
        <div className={`${styles.loupeFrame} ${styles.loupeEmpty}`}>
          <span className={styles.loupeEmptyLabel}>{t("inspectEmptyLoupe")}</span>
        </div>
      )}
      <div className={styles.chip}>
        <span className={`${styles.chipSwatch} ${styles.chipSwatchEmpty}`} />
        <span className={`${styles.chipText} ${styles.chipTextMuted}`}>
          {t("inspectEmptyChip")}
        </span>
      </div>
    </div>
  );
}

/**
 * Covers the canvas while Inspect is on and draws the HUD next to the cursor. Pointer move and
 * leave drive the readout. Wheel and pointerdown bubble to the canvas, so pan and zoom keep
 * working, EXCEPT while the ruler shows a run: then a plain wheel changes the tolerance and a
 * click pins the run; with no run shown a click picks the pixel's color into the Tool tab's
 * Color box (NIW2-911). It sits above the annotation layer, so nothing is drawn or moved meanwhile.
 */
export function InspectLayer({ inspect }: { inspect: InspectController }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const { hover, run, empty } = inspect;
  const press = useRef<{ x: number; y: number; id: number } | null>(null);
  const onWheelRef = useRef(inspect.onWheel);
  onWheelRef.current = inspect.onWheel;

  // Non-passive, and stopped here, so the canvas behind does not also pan or scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (!onWheelRef.current(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const pointer: Point | null = hover ?? empty;
  const rect = ref.current?.getBoundingClientRect();
  const px = pointer ? pointer.clientX - (rect?.left ?? 0) : 0;
  const py = pointer ? pointer.clientY - (rect?.top ?? 0) : 0;

  return (
    <div
      ref={ref}
      className={`${styles.layer} ${pointer ? styles.layerBare : ""}`}
      data-testid="inspect-layer"
      data-ruler={inspect.ruler ?? "off"}
      onPointerMove={inspect.onPointerMove}
      onPointerLeave={inspect.onPointerLeave}
      onPointerDown={(e) => {
        press.current = e.button === 0 ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
      }}
      onPointerUp={(e) => {
        const start = press.current;
        press.current = null;
        if (!start || start.id !== e.pointerId) return;
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP) return;
        // A run on show is pinned as a measurement; otherwise the click picks the color.
        if (!inspect.pin()) inspect.pick();
      }}
      onPointerCancel={() => {
        press.current = null;
      }}
    >
      {run && (
        <Ruler run={run} origin={ref.current?.getBoundingClientRect() ?? { left: 0, top: 0 }} />
      )}
      {pointer && (
        <div className={styles.cross} data-testid="inspect-crosshair" style={{ left: px, top: py }}>
          <span className={styles.crossH} />
          <span className={styles.crossV} />
          <span className={styles.crossCentre} />
        </div>
      )}
      {hover && <Hud inspect={inspect} layer={ref} />}
      {!hover && empty && <EmptyHud at={empty} layer={ref} loupe={inspect.loupeShown} />}
    </div>
  );
}
