import React, { useEffect, useRef } from "react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import { LOUPE_RADIUS, type InspectController, type InspectRun } from "./use-inspect";
import styles from "./inspect.module.css";

const HUD_OFFSET = 16;
const HUD_WIDTH = 184;
// The HUD is a loupe, a chip and a coordinates line: about this tall (the chip may wrap).
const HUD_HEIGHT = 230;
const LOUPE_SIDE = LOUPE_RADIUS * 2 + 1;
/** Half-length of the ticks across each end of the ruler, in CSS px. */
const TICK = 6;
/** A press that moves less than this, in CSS px, is a click (pins the run), not a drag. */
const CLICK_SLOP = 4;

/** The ruler under the cursor: a line between the run's outer edges, end ticks, the length. */
function Ruler({
  run,
  origin,
}: {
  run: InspectRun;
  origin: { left: number; top: number };
}): React.JSX.Element {
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
  const labelStyle = horizontal
    ? { left: (x1 + x2) / 2, top: y1 - TICK - 4 }
    : { left: x1 + TICK + 4, top: (y1 + y2) / 2 };
  return (
    <>
      <svg className={styles.ruler} data-testid="inspect-ruler" aria-hidden="true">
        <line className={styles.rulerLine} x1={x1} y1={y1} x2={x2} y2={y2} />
        {ticks.map(([ax, ay, bx, by], i) => (
          <line key={i} className={styles.rulerLine} x1={ax} y1={ay} x2={bx} y2={by} />
        ))}
      </svg>
      <span
        {...uiArea("editorImage.inspectRun")}
        className={`${styles.rulerLabel} ${horizontal ? styles.rulerLabelH : styles.rulerLabelV}`}
        style={labelStyle}
        data-testid="inspect-ruler-length"
        data-axis={run.run.axis}
        data-outer={String(run.outer)}
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
      <span className={styles.loupeCentre} />
    </div>
  );
}

/**
 * Covers the canvas while Inspect is on and draws the HUD next to the cursor. Pointer move and
 * leave drive the readout. Wheel and pointerdown bubble to the canvas, so pan and zoom keep
 * working, EXCEPT while the ruler shows a run: then a plain wheel changes the tolerance and a
 * click pins the run. It sits above the annotation layer, so nothing is drawn or moved meanwhile.
 */
export function InspectLayer({ inspect }: { inspect: InspectController }): React.JSX.Element {
  const t = useTranslations("screenshots");
  const ref = useRef<HTMLDivElement>(null);
  const { hover, readout, run } = inspect;
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

  let left = 0;
  let top = 0;
  if (hover) {
    const rect = ref.current?.getBoundingClientRect();
    const width = rect?.width ?? Infinity;
    const height = rect?.height ?? Infinity;
    const x = hover.clientX - (rect?.left ?? 0);
    const y = hover.clientY - (rect?.top ?? 0);
    left = x + HUD_OFFSET + HUD_WIDTH > width ? x - HUD_OFFSET - HUD_WIDTH : x + HUD_OFFSET;
    top = y + HUD_OFFSET + HUD_HEIGHT > height ? y - HUD_OFFSET - HUD_HEIGHT : y + HUD_OFFSET;
    left = Math.max(0, left);
    top = Math.max(0, top);
  }

  return (
    <div
      ref={ref}
      className={styles.layer}
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
        inspect.pin();
      }}
      onPointerCancel={() => {
        press.current = null;
      }}
    >
      {run && (
        <Ruler run={run} origin={ref.current?.getBoundingClientRect() ?? { left: 0, top: 0 }} />
      )}
      {hover && (
        <div
          {...uiArea("editorImage.inspectHud")}
          // "true" once the captured tile for this pixel is read: the gamut mark is final then.
          data-probed={hover.outOfGamut !== undefined}
          className={styles.hud}
          style={{ left, top }}
        >
          <Loupe pixels={inspect.loupe} />
          <div className={styles.chip}>
            <span
              className={styles.chipSwatch}
              style={{
                background: `rgba(${hover.color.r}, ${hover.color.g}, ${hover.color.b}, ${hover.color.a / 255})`,
              }}
            />
            <span className={styles.chipText}>{readout ?? "…"}</span>
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
          {hover.outOfGamut && <span className={styles.gamut}>{t("inspectOutOfSrgb")}</span>}
        </div>
      )}
    </div>
  );
}
