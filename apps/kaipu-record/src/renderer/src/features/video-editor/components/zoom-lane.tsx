/**
 * Zooms lane — one block per VISIBLE piece of each zoom segment (source-anchored, see
 * plans/video-editor-v2/06). Click selects the whole segment; the selected segment shows
 * an edge handle only where its real start/end is visible (not at inner cut edges).
 * Edge drags report SOURCE time (null while over a slide) with the same
 * start/move/end phase contract as the overlay lane.
 *
 * The handle rule picks blocks[0] / blocks.at(-1) — i.e. by TIMELINE position — and then
 * checks them against the segment's source edges. Those two orders coincide only while
 * clips stay on the timeline in source order, which they do in v2 (split, trim and
 * delete preserve it; there is no reorder UI). If reordering ever ships, select the
 * handle blocks by sourceStart/sourceEnd instead of by position.
 */
import { useRef } from "react";
import { Lock } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { sourceRangeToTimelineBlocks, sourceTimeAtTimeline } from "../source-time";
import { type LayoutEntry, layoutDuration } from "../timeline";
import type { ZoomSegment } from "../zoom/zoom-model";
import { fractionToTime, timeToFraction } from "./timeline-geometry";
import styles from "./zoom-lane.module.css";

export type EdgePhase = "start" | "move" | "end";

export interface ZoomLaneProps {
  segments: ZoomSegment[];
  layout: LayoutEntry[];
  selectedId: string | null;
  onSelect(id: string): void;
  /** `sourceTime` is null when the pointer is over a slide — ignore that move. */
  onEdgeDrag(id: string, edge: "start" | "end", sourceTime: number | null, phase: EdgePhase): void;
  /** True when the recording has a cursor track — gates the empty-state hint (plans/
   *  video-editor-v2/08 § PR 10 polish): a pre-v2 recording with no track at all already
   *  explains itself via the Detection panel's "no cursor data" text, so this lane stays
   *  silent for it instead of doubling up. Defaults to false for callers that don't pass
   *  it (e.g. existing tests with a fixed set of segments). */
  hasTrack?: boolean;
}

export function ZoomLane({
  segments,
  layout,
  selectedId,
  onSelect,
  onEdgeDrag,
  hasTrack = false,
}: ZoomLaneProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const laneRef = useRef<HTMLDivElement | null>(null);
  const dragEdge = useRef<{ id: string; edge: "start" | "end" } | null>(null);
  const duration = layoutDuration(layout);

  const sourceFromPointer = (clientX: number): number | null => {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return sourceTimeAtTimeline(
      layout,
      fractionToTime((clientX - rect.left) / rect.width, duration),
    );
  };

  const handle = (segment: ZoomSegment, edge: "start" | "end", timelineAt: number) => {
    // A pointer gesture can end without a pointerup (system gesture, capture stolen,
    // the handle unmounting mid-drag). Without this the controller stays in
    // `interacting` forever and every later commit/undo/redo silently no-ops. Same
    // abort contract as VideoAnnotationLayer's onPointerAbort.
    const abort = (): void => {
      if (!dragEdge.current) return;
      dragEdge.current = null;
      onEdgeDrag(segment.id, edge, null, "end");
    };
    return (
      <div
        key={`${segment.id}-${edge}`}
        className={styles.handle}
        style={{ left: `calc(${timeToFraction(timelineAt, duration) * 100}% - 3px)` }}
        data-zoom-handle={edge}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          dragEdge.current = { id: segment.id, edge };
          onEdgeDrag(segment.id, edge, edge === "start" ? segment.start : segment.end, "start");
        }}
        onPointerMove={(event) => {
          event.stopPropagation();
          const drag = dragEdge.current;
          if (!drag || drag.id !== segment.id || drag.edge !== edge) return;
          onEdgeDrag(segment.id, edge, sourceFromPointer(event.clientX), "move");
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          if (!dragEdge.current) return;
          // Release first: the lostpointercapture this queues finds dragEdge already
          // null after abort(), so the "end" phase is reported exactly once.
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          abort();
        }}
        onPointerCancel={abort}
        onLostPointerCapture={abort}
      />
    );
  };

  return (
    <div ref={laneRef} className={styles.lane} data-testid="zoom-lane">
      {segments.length === 0 && hasTrack && <p className={styles.empty}>{t("zoomEmptyState")}</p>}
      {segments.flatMap((segment, index) => {
        const blocks = sourceRangeToTimelineBlocks(layout, segment.start, segment.end);
        const selected = segment.id === selectedId;
        const nodes = blocks.map((block, i) => (
          <button
            key={`${segment.id}-${i}`}
            type="button"
            className={selected ? `${styles.block} ${styles.selected}` : styles.block}
            style={{
              left: `${timeToFraction(block.timelineStart, duration) * 100}%`,
              width: `${timeToFraction(block.timelineEnd - block.timelineStart, duration) * 100}%`,
            }}
            data-zoom-id={segment.id}
            // A block's visible text is "2.1×", which says nothing on its own; name it
            // the same way the inspector heading does. Every piece of a split segment
            // carries the same name and pressed state — they are one toggle.
            aria-label={t("zoomTitle", { n: index + 1 })}
            aria-pressed={selected}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(segment.id);
            }}
          >
            <span className={styles.level}>{segment.scale.toFixed(1)}×</span>
            {segment.mode === "fixed" && <Lock size={10} className={styles.lock} />}
          </button>
        ));
        if (selected && blocks.length > 0) {
          const first = blocks[0];
          const last = blocks[blocks.length - 1];
          if (first.sourceStart === segment.start)
            nodes.push(handle(segment, "start", first.timelineStart));
          if (last.sourceEnd === segment.end) nodes.push(handle(segment, "end", last.timelineEnd));
        }
        return nodes;
      })}
    </div>
  );
}
