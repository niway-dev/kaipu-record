import { useCallback, useEffect, useRef } from "react";
import type { PreviewPlayback } from "../use-preview-playback";
import type { LayoutEntry } from "../timeline";
import { layoutDuration } from "../timeline";
import type { SourceThumbnail } from "../use-source-thumbnails";
import {
  fractionToTime,
  rulerTicks,
  thumbnailsForRange,
  timeToFraction,
} from "./timeline-geometry";
import styles from "./timeline-strip.module.css";

const THUMBS_PER_BLOCK_PX = 72; // one thumbnail tile roughly every 72px of block width

export function TimelineStrip({
  layout,
  playback,
  thumbnails,
  selectedItemId,
  onSelectItem,
  onTrim,
}: {
  layout: LayoutEntry[];
  playback: PreviewPlayback;
  thumbnails: SourceThumbnail[];
  selectedItemId: string | null;
  onSelectItem: (id: string | null) => void;
  /** Fired while dragging a trim handle. `phase` tracks the drag lifecycle so the
   *  page can collapse the whole drag into a single undo step. */
  onTrim?: (
    itemId: string,
    edge: "start" | "end",
    sourceTime: number,
    phase: "start" | "move" | "end",
  ) => void;
}): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const duration = layoutDuration(layout);

  // Playhead follows playback at rAF frequency via direct style mutation —
  // re-rendering the strip 60×/s would drop frames during playback.
  useEffect(() => {
    return playback.subscribeTime((t) => {
      const el = playheadRef.current;
      if (el) el.style.left = `${timeToFraction(t, duration) * 100}%`;
    });
  }, [playback, duration]);

  // Also position on low-frequency updates (paused seeks don't run the rAF loop).
  useEffect(() => {
    const el = playheadRef.current;
    if (el) el.style.left = `${timeToFraction(playback.timelineTime, duration) * 100}%`;
  }, [playback.timelineTime, duration]);

  const timeFromPointer = useCallback(
    (event: { clientX: number }): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 0;
      return fractionToTime((event.clientX - rect.left) / rect.width, duration);
    },
    [duration],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      playback.pause();
      playback.seek(timeFromPointer(event));
    },
    [playback, timeFromPointer],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      playback.seek(timeFromPointer(event));
    },
    [playback, timeFromPointer],
  );

  return (
    <div className={styles.strip}>
      <div className={styles.ruler}>
        {rulerTicks(duration).map((tick) => (
          <span
            key={tick.time}
            className={styles.tick}
            style={{ left: `${timeToFraction(tick.time, duration) * 100}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
      <div
        ref={trackRef}
        className={styles.track}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        {layout.map((entry) => (
          <TrackBlock
            key={entry.itemId}
            entry={entry}
            duration={duration}
            thumbnails={thumbnails}
            selected={entry.itemId === selectedItemId}
            onSelect={() => onSelectItem(entry.itemId)}
            timeFromPointer={timeFromPointer}
            onTrim={onTrim}
          />
        ))}
        <div ref={playheadRef} className={styles.playhead} />
      </div>
    </div>
  );
}

function TrackBlock({
  entry,
  duration,
  thumbnails,
  selected,
  onSelect,
  timeFromPointer,
  onTrim,
}: {
  entry: LayoutEntry;
  duration: number;
  thumbnails: SourceThumbnail[];
  selected: boolean;
  onSelect: () => void;
  timeFromPointer: (event: { clientX: number }) => number;
  onTrim?: (
    itemId: string,
    edge: "start" | "end",
    sourceTime: number,
    phase: "start" | "move" | "end",
  ) => void;
}): React.JSX.Element {
  const blockRef = useRef<HTMLButtonElement | null>(null);
  const left = timeToFraction(entry.timelineStart, duration) * 100;
  const width = timeToFraction(entry.timelineEnd - entry.timelineStart, duration) * 100;
  const approxWidthPx = (width / 100) * (blockRef.current?.parentElement?.clientWidth ?? 800);
  const tiles =
    entry.kind === "clip"
      ? thumbnailsForRange(
          thumbnails,
          entry.sourceStart,
          entry.sourceEnd,
          Math.max(1, Math.round(approxWidthPx / THUMBS_PER_BLOCK_PX)),
        )
      : [];

  // The pointer moves in timeline space; the handle drags in SOURCE space for this
  // entry — convert via the entry's own timeline↔source offset (see timeline.ts).
  const sourceTimeFromPointer = (event: { clientX: number }): number =>
    entry.sourceStart + (timeFromPointer(event) - entry.timelineStart);

  // One handler factory for both edges — pointerdown seeds the drag with the edge's
  // current source time, move reports the live source time, up ends the drag. The
  // page maps these three phases to beginInteract/updateLive+trimClip/endInteract.
  const trimHandlers = (
    edge: "start" | "end",
  ): {
    onPointerDown: React.PointerEventHandler<HTMLDivElement>;
    onPointerMove: React.PointerEventHandler<HTMLDivElement>;
    onPointerUp: React.PointerEventHandler<HTMLDivElement>;
  } => ({
    onPointerDown: (event) => {
      // Neither scrub the track nor re-select the block underneath.
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      onTrim?.(entry.itemId, edge, edge === "start" ? entry.sourceStart : entry.sourceEnd, "start");
    },
    onPointerMove: (event) => {
      event.stopPropagation();
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      onTrim?.(entry.itemId, edge, sourceTimeFromPointer(event), "move");
    },
    onPointerUp: (event) => {
      event.stopPropagation();
      onTrim?.(entry.itemId, edge, sourceTimeFromPointer(event), "end");
    },
  });

  return (
    <>
      <button
        ref={blockRef}
        type="button"
        className={selected ? `${styles.block} ${styles.blockSelected}` : styles.block}
        style={{ left: `${left}%`, width: `${width}%` }}
        onPointerDown={(event) => {
          // Stop the pointerdown from bubbling to the track handler, which pauses
          // and scrubs on pointerdown — stopping on click alone is too late.
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation(); // a block click selects; it must not also scrub
          onSelect();
        }}
      >
        {tiles.map((tile, i) => (
          <img key={i} src={tile.url} alt="" className={styles.tile} draggable={false} />
        ))}
      </button>
      {/* Rendered as siblings, not children of the button: the button clips its
          thumbnails with overflow:hidden, which would also clip a handle sitting
          half outside the block's edge. */}
      {selected && entry.kind === "clip" && (
        <>
          <div
            className={styles.trimHandle}
            style={{ left: `calc(${left}% - 4px)` }}
            {...trimHandlers("start")}
          />
          <div
            className={styles.trimHandle}
            style={{ left: `calc(${left + width}% - 4px)` }}
            {...trimHandlers("end")}
          />
        </>
      )}
    </>
  );
}
