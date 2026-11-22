import { useRef, useState, type PointerEvent } from "react";

import {
  DEFAULT_AREA,
  FULL_REGION,
  regionFromDrag,
  regionPixels,
  settleRegion,
  clamp,
  type Pt,
  type Region,
} from "./hero-stage-model";
import styles from "./hero-stage.module.css";
import { SampleScreen, Segmented, type T } from "./stage-parts";
import { useHold } from "./use-auto-demo";

type Kind = "area" | "full";

/**
 * Screenshot: the selection overlay sits on the same sample screen. Outside
 * the selection is dimmed. "Area" lets the visitor drag a new selection (a
 * plain click keeps the default one), "Full screen" selects everything, and
 * "Capture" hands the selection to the editor's image canvas.
 */
export function ScreenshotStage({
  t,
  onCapture,
  onHold,
}: {
  t: T;
  onCapture: (region: Region) => void;
  onHold: (id: string, active: boolean) => void;
}) {
  const [kind, setKind] = useState<Kind>("area");
  const [touchSelects, setTouchSelects] = useState(false);
  const [area, setArea] = useState<Region>(DEFAULT_AREA);
  const screen = useRef<HTMLDivElement>(null);
  const anchor = useRef<Pt | null>(null);

  // A chosen selection is the visitor's work: the demo does not take the screen away from it.
  useHold(onHold, "screenshot", kind !== "area" || area !== DEFAULT_AREA);

  const region = kind === "full" ? FULL_REGION : area;
  const px = regionPixels(region);

  const point = (e: PointerEvent): Pt => {
    const box = screen.current!.getBoundingClientRect();
    return {
      x: clamp((e.clientX - box.left) / box.width, 0, 1),
      y: clamp((e.clientY - box.top) / box.height, 0, 1),
    };
  };

  const start = (e: PointerEvent) => {
    if (kind !== "area" || (e.pointerType !== "mouse" && !touchSelects)) return;
    anchor.current = point(e);
    setArea({ ...anchor.current, w: 0, h: 0 });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (anchor.current) setArea(regionFromDrag(anchor.current, point(e)));
  };
  const end = () => {
    if (!anchor.current) return;
    anchor.current = null;
    setArea((r) => settleRegion(r));
  };

  return (
    <div className={styles.screen} ref={screen}>
      <SampleScreen t={t} />

      <div
        className={`${styles.select} ${kind === "full" ? styles.selectFull : ""}`}
        data-testid="selection-surface"
        data-touch={kind === "area" && touchSelects ? "select" : "scroll"}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div
          className={`${styles.region} ${kind === "full" ? styles.regionFull : ""}`}
          data-testid="selection-region"
          style={{
            left: `${region.x * 100}%`,
            top: `${region.y * 100}%`,
            width: `${region.w * 100}%`,
            height: `${region.h * 100}%`,
          }}
        >
          <span className={styles.regionSize}>
            {px.w} × {px.h}
          </span>
        </div>
        {kind === "area" && <span className={styles.hint}>{t("homeStageDragHint")}</span>}
      </div>

      <div
        className={styles.dock}
        onPointerDown={(e) => e.stopPropagation()}
        role="group"
        aria-label={t("homeStageScreenshot")}
      >
        <Segmented<Kind>
          label={t("homeStageScreenshot")}
          value={kind}
          onChange={(value) => {
            setKind(value);
            setTouchSelects(value === "area");
          }}
          options={[
            { value: "area", label: t("homeStageArea") },
            { value: "full", label: t("homeStageFullScreen") },
          ]}
        />
        <button type="button" className={styles.dockPrimary} onClick={() => onCapture(region)}>
          {t("homeStageCapture")}
        </button>
      </div>
    </div>
  );
}
