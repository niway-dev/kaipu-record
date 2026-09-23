/**
 * Move / resize the SELECTED privacy region (UI spec § 4.3: 1.5 px accent border + four
 * white corner handles). Stage chrome over the unzoomed frame, like region-drawer: the
 * camera is off while a region is selected, so stage-normalized = original-frame coords.
 * Same begin → change… → end contract as every continuous edit (doc 07).
 */
import { useRef } from "react";
import { type Corner, moveRect, resizeRect } from "../privacy/region-geometry";
import type { NormRect } from "../privacy/redaction";
import { rectStyle } from "./redaction-layer";
import styles from "./region-editor.module.css";

const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];

type Drag = { mode: "move"; from: { x: number; y: number }; orig: NormRect } | { mode: Corner };

export function RegionEditor({
  rect,
  onBegin,
  onChange,
  onEnd,
}: {
  rect: NormRect;
  onBegin(): void;
  onChange(rect: NormRect): void;
  onEnd(): void;
}): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);

  const norm = (event: React.PointerEvent): { x: number; y: number } | null => {
    const stage = boxRef.current?.parentElement?.getBoundingClientRect();
    if (!stage || stage.width === 0 || stage.height === 0) return null;
    return {
      x: (event.clientX - stage.left) / stage.width,
      y: (event.clientY - stage.top) / stage.height,
    };
  };

  const begin = (event: React.PointerEvent, next: Drag): void => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = next;
    onBegin();
  };

  const move = (event: React.PointerEvent): void => {
    const d = drag.current;
    const p = norm(event);
    if (!d || !p) return;
    if (d.mode === "move") onChange(moveRect(d.orig, p.x - d.from.x, p.y - d.from.y));
    else onChange(resizeRect(rect, d.mode, p));
  };

  const end = (): void => {
    if (!drag.current) return;
    drag.current = null;
    onEnd();
  };

  // A pointer gesture can end without a pointerup (system gesture, capture stolen) —
  // abort cleanly through the same end() so the drag never gets stranded mid-interaction
  // (same contract as VideoAnnotationLayer's onPointerAbort and ZoomLane's handle abort).
  const abort = end;

  return (
    <div
      ref={boxRef}
      className={styles.box}
      style={rectStyle(rect)}
      data-testid="region-editor"
      onPointerDown={(event) => {
        const p = norm(event);
        if (p) begin(event, { mode: "move", from: p, orig: rect });
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={abort}
      onLostPointerCapture={abort}
    >
      {CORNERS.map((corner) => (
        <span
          key={corner}
          className={`${styles.handle} ${styles[corner]}`}
          data-region-handle={corner}
          onPointerDown={(event) => begin(event, { mode: corner })}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={abort}
          onLostPointerCapture={abort}
        />
      ))}
    </div>
  );
}
