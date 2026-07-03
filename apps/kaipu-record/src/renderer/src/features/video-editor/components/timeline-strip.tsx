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
}: {
  layout: LayoutEntry[];
  playback: PreviewPlayback;
  thumbnails: SourceThumbnail[];
  selectedItemId: string | null;
  onSelectItem: (id: string | null) => void;
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
}: {
  entry: LayoutEntry;
  duration: number;
  thumbnails: SourceThumbnail[];
  selected: boolean;
  onSelect: () => void;
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

  return (
    <button
      ref={blockRef}
      type="button"
      className={selected ? `${styles.block} ${styles.blockSelected}` : styles.block}
      style={{ left: `${left}%`, width: `${width}%` }}
      onClick={(event) => {
        event.stopPropagation(); // a block click selects; it must not also scrub
        onSelect();
      }}
    >
      {tiles.map((tile, i) => (
        <img key={i} src={tile.url} alt="" className={styles.tile} draggable={false} />
      ))}
    </button>
  );
}
