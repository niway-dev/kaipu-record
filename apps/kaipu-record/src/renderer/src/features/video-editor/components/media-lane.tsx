/**
 * Media lane — the floating images of the Clips section, drawn on rows above the sequence
 * (NIW2-771, spec 2026-11-13 §1). `media.rows` says which row each item is on (1 is just above
 * the sequence, higher is further up); this lane only draws, and reports gestures in TIMELINE
 * seconds: the page turns them into anchors, durations and clamps (`moveMedia`,
 * `resizeMediaEdge` in media.ts), so nothing here knows the minimum duration or the timeline end.
 *
 * Every block is a sibling in ONE flat list, placed by its row, instead of a child of a row
 * element: an item dragged over another one changes row live, and a block that moved to a
 * different parent would remount and lose its pointer capture mid-drag.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import type { TimelineMedia } from "./media-lane-contract";
import { timeToFraction } from "./timeline-geometry";
import { useTimelinePointer } from "./timeline-pointer";
import styles from "./media-lane.module.css";

export interface MediaLaneProps {
  media: TimelineMedia;
  /** Timeline duration in seconds; left/width are shares of it, like every other lane. */
  duration: number;
}

type DragMode = "move" | "start" | "end";

export const MediaLane = memo(function MediaLane({
  media,
  duration,
}: MediaLaneProps): React.JSX.Element {
  const laneRef = useRef<HTMLDivElement | null>(null);
  // The strip's one pixel-to-time conversion (zoom and scroll aware); alone, this lane's box.
  const timeAtPointer = useTimelinePointer(laneRef, duration);
  const timeFromPointer = (event: { clientX: number }): number => timeAtPointer(event.clientX) ?? 0;

  // Distinct row numbers, nearest the sequence first. The highest row is drawn at the top.
  const rowNumbers = useMemo(
    () =>
      [...new Set(media.placed.map((p) => media.rows.get(p.item.id) ?? 1))].sort((a, b) => a - b),
    [media.placed, media.rows],
  );
  const rowCount = rowNumbers.length;
  // 0 = the top row on screen.
  const positionOf = (row: number): number => rowCount - 1 - Math.max(0, rowNumbers.indexOf(row));

  return (
    <div
      ref={laneRef}
      className={styles.lane}
      data-testid="media-lane"
      {...uiArea("editorVideo.timelineMediaRows")}
      style={{
        height: `calc(${rowCount} * var(--media-row-h, 28px) + ${Math.max(0, rowCount - 1)} * var(--media-row-gap, 2px))`,
      }}
    >
      {rowNumbers.map((row) => (
        <div
          key={`row-${row}`}
          className={styles.row}
          data-testid={`media-row-${row}`}
          style={{ "--row-pos": positionOf(row) } as React.CSSProperties}
        />
      ))}
      {media.placed.map((placed) => {
        const row = media.rows.get(placed.item.id) ?? 1;
        return (
          <MediaBlock
            key={placed.item.id}
            id={placed.item.id}
            assetId={placed.item.assetId}
            start={placed.start}
            end={placed.end}
            row={row}
            position={positionOf(row)}
            duration={duration}
            selected={placed.item.id === media.selectedId}
            media={media}
            timeFromPointer={timeFromPointer}
          />
        );
      })}
    </div>
  );
});

function MediaBlock({
  id,
  assetId,
  start,
  end,
  row,
  position,
  duration,
  selected,
  media,
  timeFromPointer,
}: {
  id: string;
  assetId: string;
  start: number;
  end: number;
  row: number;
  position: number;
  duration: number;
  selected: boolean;
  media: TimelineMedia;
  timeFromPointer: (event: { clientX: number }) => number;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const left = timeToFraction(start, duration) * 100;
  const width = timeToFraction(end - start, duration) * 100;
  const url = media.imageUrl(assetId);

  // The drag's baseline is frozen on pointerdown (the item's start then, and the time under
  // the pointer then): a move is `origStart + (time now - time then)`, never derived from the
  // live item, so the item following the pointer cannot feed back into the next delta.
  const drag = useRef<{ mode: DragMode; t0: number; origStart: number } | null>(null);
  // The latest callbacks, for the unmount cleanup below (it must not re-run on a re-render).
  const latest = useRef(media);
  latest.current = media;

  // A captured pointer is not released by its element going away (the item deleted or the
  // lane unmounted mid-drag), so neither `finish` ever runs: end the drag by hand, or the page
  // stays inside an interaction that no longer exists.
  useEffect(
    () => () => {
      if (!drag.current) return;
      drag.current = null;
      latest.current.onInteractionEnd();
    },
    [],
  );

  // Reports the end exactly once: pointerup releases capture first, so the lostpointercapture
  // it queues finds the ref already null (zoom-lane.tsx contract).
  const finish = (): void => {
    if (!drag.current) return;
    drag.current = null;
    media.onInteractionEnd();
  };

  const handlers = (mode: DragMode) => ({
    onPointerDown: (event: React.PointerEvent<HTMLElement>): void => {
      // Left button only: a context click must not start a drag it never finishes.
      if (event.button !== 0) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      media.onSelect(id);
      drag.current = { mode, t0: timeFromPointer(event), origStart: start };
      media.onInteractionStart();
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>): void => {
      const current = drag.current;
      if (!current || current.mode !== mode) return; // a hover, or the other part's drag
      event.stopPropagation();
      const time = timeFromPointer(event);
      if (mode === "move") {
        media.onMove(id, Math.max(0, current.origStart + (time - current.t0)));
      } else {
        media.onResizeEdge(id, mode, Math.max(0, time));
      }
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>): void => {
      if (!drag.current || drag.current.mode !== mode) return;
      event.stopPropagation();
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      finish();
    },
    onPointerCancel: finish,
    onLostPointerCapture: finish,
  });

  const rowVars = { "--row-pos": position } as React.CSSProperties;
  return (
    <>
      <button
        type="button"
        className={selected ? `${styles.block} ${styles.blockSelected}` : styles.block}
        style={{ ...rowVars, left: `${left}%`, width: `${width}%` }}
        data-testid={`media-block-${id}`}
        data-row={row}
        aria-label={t("timelineMediaBlock")}
        aria-pressed={selected}
        // A mouse click selects on pointerdown (so a drag of an unselected item selects it
        // first); `detail === 0` is a keyboard activation, which has no pointerdown.
        onClick={(event) => {
          event.stopPropagation();
          if (event.detail === 0) media.onSelect(id);
        }}
        {...handlers("move")}
      >
        {url && <img src={url} alt="" className={styles.thumb} draggable={false} />}
      </button>
      {/* Siblings of the block, not children: its overflow would clip a handle that sits half
          outside the edge, and a handle's pointerdown would bubble into the body drag. */}
      <div
        className={styles.handle}
        style={{ ...rowVars, left: `calc(${left}% - 4px)` }}
        data-testid={`media-handle-${id}-start`}
        data-media-handle="start"
        aria-hidden
        title={t("timelineMediaResizeStart")}
        {...handlers("start")}
      />
      <div
        className={styles.handle}
        style={{ ...rowVars, left: `calc(${left + width}% - 4px)` }}
        data-testid={`media-handle-${id}-end`}
        data-media-handle="end"
        aria-hidden
        title={t("timelineMediaResizeEnd")}
        {...handlers("end")}
      />
    </>
  );
}
