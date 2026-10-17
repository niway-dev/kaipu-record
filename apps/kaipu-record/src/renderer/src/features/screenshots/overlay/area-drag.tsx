import { useState } from "react";
import type { CaptureRect } from "@shared/types/screenshot-capture";
import type { SendAnswer } from "./capture-overlay";
import type { OverlayQuery } from "./overlay-query";
import styles from "./capture-overlay.module.css";

/** A press that moves less than this (DIP) on both axes is a click, not a drag. */
export const MIN_DRAG_DIP = 4;

type Pt = { x: number; y: number };

const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);

/** The rectangle spanned by two points, clamped to the window, at least 1×1 DIP. */
export function dragRect(from: Pt, to: Pt, bounds: { width: number; height: number }): CaptureRect {
  const x1 = clamp(Math.round(from.x), bounds.width);
  const y1 = clamp(Math.round(from.y), bounds.height);
  const x2 = clamp(Math.round(to.x), bounds.width);
  const y2 = clamp(Math.round(to.y), bounds.height);
  const x = Math.min(Math.min(x1, x2), bounds.width - 1);
  const y = Math.min(Math.min(y1, y2), bounds.height - 1);
  return {
    x,
    y,
    width: Math.max(1, Math.abs(x2 - x1)),
    height: Math.max(1, Math.abs(y2 - y1)),
  };
}

interface AreaDragProps {
  query: OverlayQuery;
  send: SendAnswer;
}

/**
 * Area mode (the Windows area picker; macOS keeps Apple's `screencapture -i`):
 * press, drag and release to draw a rectangle; the release answers it. A click without
 * a drag does nothing, so a stray click does not capture a sliver.
 */
export function AreaDrag({ query, send }: AreaDragProps): React.JSX.Element {
  const [drag, setDrag] = useState<{ from: Pt; to: Pt } | null>(null);

  const point = (event: React.PointerEvent): Pt => ({ x: event.clientX, y: event.clientY });

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    const at = point(event);
    setDrag({ from: at, to: at });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag) return;
    setDrag({ from: drag.from, to: point(event) });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag) return;
    const to = point(event);
    setDrag(null);
    const moved = Math.max(Math.abs(to.x - drag.from.x), Math.abs(to.y - drag.from.y));
    if (moved < MIN_DRAG_DIP) return;
    send({ kind: "rect", displayId: query.displayId, rect: dragRect(drag.from, to, query.bounds) });
  };

  const rect = drag ? dragRect(drag.from, drag.to, query.bounds) : null;

  return (
    <div
      className={`${styles.sheet} ${styles.area}`}
      data-testid="capture-area"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      {rect && (
        <>
          <div
            className={styles.box}
            style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
          />
          <div className={styles.pill} style={{ left: rect.x, top: Math.max(0, rect.y - 24) }}>
            {rect.width} × {rect.height}
          </div>
        </>
      )}
    </div>
  );
}
