/**
 * Overlay lane — a thin strip above the main track showing every annotation's
 * visibility window as a draggable/resizable pill (the video-editor sibling of the
 * main track's trim handles; see timeline-strip.tsx TrackBlock). Body drag moves the
 * window (preserving its length); the end handles resize it. Both interactions map
 * to the same begin/live/end history pattern the trim handles use, via onWindowChange.
 */
import { useRef } from "react";
import { ArrowUpRight, Square, Type } from "lucide-react";
import type { VideoOverlay } from "../scene";
import { fractionToTime, timeToFraction } from "./timeline-geometry";
import styles from "./overlay-lane.module.css";

const KIND_ICON: Record<VideoOverlay["kind"], typeof Square> = {
  box: Square,
  arrow: ArrowUpRight,
  text: Type,
};

/** Same floor as the resize handles use here, so a window can never collapse to a
 *  sliver that's impossible to grab again. */
const MIN_WINDOW_SECONDS = 0.2;

export type WindowChangePhase = "start" | "move" | "end";

export interface OverlayLaneProps {
  overlays: VideoOverlay[];
  duration: number;
  selectedOverlayId: string | null;
  onSelectOverlay(id: string | null): void;
  /** Fired while dragging a pill's body (move) or an end handle (resize). `phase`
   *  tracks the drag lifecycle so the page can collapse it into a single undo step —
   *  identical contract to TimelineStrip's onTrim. */
  onWindowChange(id: string, start: number, end: number, phase: WindowChangePhase): void;
}

export function OverlayLane({
  overlays,
  duration,
  selectedOverlayId,
  onSelectOverlay,
  onWindowChange,
}: OverlayLaneProps): React.JSX.Element {
  const laneRef = useRef<HTMLDivElement | null>(null);

  const timeFromPointer = (event: { clientX: number }): number => {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return fractionToTime((event.clientX - rect.left) / rect.width, duration);
  };

  return (
    <div ref={laneRef} className={styles.lane}>
      {overlays.map((overlay) => (
        <Pill
          key={overlay.id}
          overlay={overlay}
          duration={duration}
          selected={overlay.id === selectedOverlayId}
          onSelect={() => onSelectOverlay(overlay.id)}
          timeFromPointer={timeFromPointer}
          onWindowChange={onWindowChange}
        />
      ))}
    </div>
  );
}

function Pill({
  overlay,
  duration,
  selected,
  onSelect,
  timeFromPointer,
  onWindowChange,
}: {
  overlay: VideoOverlay;
  duration: number;
  selected: boolean;
  onSelect: () => void;
  timeFromPointer: (event: { clientX: number }) => number;
  onWindowChange: OverlayLaneProps["onWindowChange"];
}): React.JSX.Element {
  const Icon = KIND_ICON[overlay.kind];
  const left = timeToFraction(overlay.start, duration) * 100;
  const width = timeToFraction(overlay.end - overlay.start, duration) * 100;

  // Body drag shifts BOTH edges by the pointer's time delta since drag start,
  // preserving the window's length — computed from a fixed baseline (captured once,
  // on pointerdown) so successive moves never drift the way an incremental delta
  // could. Mirrors the "resize from ORIGINAL geometry" note in video-annotation-layer.
  const bodyOrigin = useRef<{ startTime: number; origStart: number; origEnd: number } | null>(null);

  const onBodyPointerDown = (event: React.PointerEvent<HTMLButtonElement>): void => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSelect();
    bodyOrigin.current = {
      startTime: timeFromPointer(event),
      origStart: overlay.start,
      origEnd: overlay.end,
    };
    onWindowChange(overlay.id, overlay.start, overlay.end, "start");
  };

  const onBodyPointerMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const origin = bodyOrigin.current;
    if (!origin) return;
    const delta = timeFromPointer(event) - origin.startTime;
    const length = origin.origEnd - origin.origStart;
    const start = Math.max(0, Math.min(origin.origStart + delta, duration - length));
    onWindowChange(overlay.id, start, start + length, "move");
  };

  const onBodyPointerUp = (): void => {
    bodyOrigin.current = null;
    onWindowChange(overlay.id, overlay.start, overlay.end, "end");
  };

  // End handles resize by setting the dragged edge directly to the pointer's time
  // (no delta math needed — the opposite edge stays put, read live off `overlay`).
  // `resizeEdge` gates onPointerMove exactly like `bodyOrigin` gates the body drag
  // above: set to the dragged edge on pointerdown, cleared on pointerup. Without it,
  // a plain hover over the handle (pointermove firing with no button pressed) would
  // reach `onWindowChange(..., "move")` and silently snap the window — the page's
  // "move" phase maps straight to `updateLive`, which has no active-interaction guard.
  const resizeEdge = useRef<"start" | "end" | null>(null);

  const handleHandlers = (
    edge: "start" | "end",
  ): {
    onPointerDown: React.PointerEventHandler<HTMLDivElement>;
    onPointerMove: React.PointerEventHandler<HTMLDivElement>;
    onPointerUp: React.PointerEventHandler<HTMLDivElement>;
  } => ({
    onPointerDown: (event) => {
      // Neither move the pill nor let the click bubble to a select/drag on the body.
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      onSelect();
      resizeEdge.current = edge;
      onWindowChange(overlay.id, overlay.start, overlay.end, "start");
    },
    onPointerMove: (event) => {
      event.stopPropagation();
      if (resizeEdge.current !== edge) return; // hover with no active drag — ignore
      const t = timeFromPointer(event);
      if (edge === "start") {
        const start = Math.max(0, Math.min(t, overlay.end - MIN_WINDOW_SECONDS));
        onWindowChange(overlay.id, start, overlay.end, "move");
      } else {
        const end = Math.min(duration, Math.max(t, overlay.start + MIN_WINDOW_SECONDS));
        onWindowChange(overlay.id, overlay.start, end, "move");
      }
    },
    onPointerUp: (event) => {
      event.stopPropagation();
      resizeEdge.current = null;
      onWindowChange(overlay.id, overlay.start, overlay.end, "end");
    },
  });

  return (
    <>
      <button
        type="button"
        className={selected ? `${styles.pill} ${styles.pillSelected}` : styles.pill}
        style={{ left: `${left}%`, width: `${width}%`, background: `${overlay.color}b3` }}
        onPointerDown={onBodyPointerDown}
        onPointerMove={onBodyPointerMove}
        onPointerUp={onBodyPointerUp}
      >
        <Icon size={10} className={styles.icon} />
      </button>
      {/* Siblings, not children of the button — a handle's pointerdown would
          otherwise bubble into the pill button's own onPointerDown (React attaches
          synthetic handlers that see bubbled events from DOM children), firing a
          body-drag on top of the resize. Same layout convention as the main track's
          trim handles (timeline-strip.tsx). */}
      <div
        className={styles.handle}
        style={{ left: `calc(${left}% - 3px)` }}
        data-overlay-handle="start"
        {...handleHandlers("start")}
      />
      <div
        className={styles.handle}
        style={{ left: `calc(${left + width}% - 3px)` }}
        data-overlay-handle="end"
        {...handleHandlers("end")}
      />
    </>
  );
}
