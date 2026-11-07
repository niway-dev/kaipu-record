/**
 * Webcam lane (ADR 0038): one block per VISIBLE piece of each hide/override segment,
 * source-anchored like the zoom lane, whose patterns it follows — click selects the whole
 * segment, the selected segment shows an edge handle only where its real start/end is
 * visible, and edge drags report SOURCE time (null over a slide) with the start/move/end
 * phase contract. Hidden segments are striped; overrides read "Custom". Deleting goes
 * through the inspector or the Delete key, like every other lane.
 *
 * Under the segments runs a filmstrip of the webcam file's own frames, laid out per clip
 * like the clips lane, so the row reads as "the face" even with no segment on it.
 */
import { memo, useRef } from "react";
import { EyeOff } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { sourceRangeToTimelineBlocks, sourceTimeAtTimeline } from "../source-time";
import { type LayoutEntry, layoutDuration } from "../timeline";
import type { CoveredRange, SourceThumbnail } from "../use-source-thumbnails";
import type { WebcamSegment } from "../webcam/webcam-model";
import { thumbnailAt, thumbnailTiles, timeToFraction } from "./timeline-geometry";
import { useTimelinePointer, useTimelineViewContext } from "./timeline-pointer";
import { scaleOf, visibleRange } from "./timeline-view";
import type { EdgePhase } from "./zoom-lane";
import styles from "./webcam-lane.module.css";
import { uiArea } from "@renderer/lib/ui-area";

/** No known range: every tile gets its nearest frame. */
const ALL_SOURCE: CoveredRange = { start: -Infinity, end: Infinity };

export interface WebcamLaneProps {
  segments: WebcamSegment[];
  layout: LayoutEntry[];
  /** The webcam file's frames at SOURCE time (`useSourceThumbnails` with the offset). */
  thumbnails?: SourceThumbnail[];
  /** Where the webcam file has footage, in SOURCE time; a tile outside it stays empty. */
  covered?: CoveredRange | null;
  selectedId: string | null;
  onSelect(id: string): void;
  /** `sourceTime` is null when the pointer is over a slide — ignore that move. */
  onEdgeDrag(id: string, edge: "start" | "end", sourceTime: number | null, phase: EdgePhase): void;
}

export const WebcamLane = memo(function WebcamLane({
  segments,
  layout,
  thumbnails = [],
  covered = null,
  selectedId,
  onSelect,
  onEdgeDrag,
}: WebcamLaneProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const laneRef = useRef<HTMLDivElement | null>(null);
  const dragEdge = useRef<{ id: string; edge: "start" | "end" } | null>(null);
  const duration = layoutDuration(layout);

  // The pointer's SOURCE time, through the strip's one pixel-to-time conversion (it knows
  // the zoom and the scroll; this lane does not). Null over a slide or while unmeasured.
  const timeAtPointer = useTimelinePointer(laneRef, duration);
  const sourceFromPointer = (clientX: number): number | null => {
    const at = timeAtPointer(clientX);
    return at === null ? null : sourceTimeAtTimeline(layout, at);
  };

  const handle = (segment: WebcamSegment, edge: "start" | "end", timelineAt: number) => {
    // Same abort contract as ZoomLane: a gesture can end without a pointerup.
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
        data-webcam-handle={edge}
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
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          abort();
        }}
        onPointerCancel={abort}
        onLostPointerCapture={abort}
      />
    );
  };

  // The filmstrip is windowed like the clips lane's: only the tiles on screen exist. Under
  // a strip the scale and the window come from its view; alone (a test) from this box.
  const view = useTimelineViewContext();
  const scale = view
    ? scaleOf(view)
    : duration > 0
      ? (laneRef.current?.clientWidth ?? 800) / duration
      : 0;
  const shown = view && scale > 0 ? visibleRange(view) : { start: 0, end: duration };
  const range = covered ?? ALL_SOURCE;
  const filmstrip =
    thumbnails.length > 0 ? (
      // Decoration only: the segments above carry every interaction and accessible name.
      <div className={styles.filmstrip} data-webcam-filmstrip aria-hidden="true">
        {layout.map((entry) => {
          if (entry.kind !== "clip") return null; // a slide has no webcam
          const width = timeToFraction(entry.timelineEnd - entry.timelineStart, duration);
          const { tiles } = thumbnailTiles({
            timelineStart: entry.timelineStart,
            timelineEnd: entry.timelineEnd,
            sourceStart: entry.sourceStart,
            sourceEnd: entry.sourceEnd,
            scale,
            visible: shown,
          });
          return (
            <div
              key={entry.itemId}
              className={styles.strip}
              style={{
                left: `${timeToFraction(entry.timelineStart, duration) * 100}%`,
                width: `${width * 100}%`,
              }}
            >
              {tiles.map((tile) => {
                // A tile outside the file's footage stays empty: it must not borrow a frame.
                const thumb = thumbnailAt(thumbnails, tile.sourceTime, range);
                return thumb ? (
                  <img
                    key={tile.index}
                    src={thumb.url}
                    alt=""
                    className={styles.tile}
                    style={{ left: `${tile.left * 100}%`, width: `${tile.width * 100}%` }}
                    draggable={false}
                  />
                ) : null;
              })}
            </div>
          );
        })}
      </div>
    ) : null;

  return (
    <div
      ref={laneRef}
      {...uiArea("editorVideo.webcamLane")}
      className={styles.lane}
      data-testid="webcam-lane"
    >
      {filmstrip}
      {segments.flatMap((segment, index) => {
        const blocks = sourceRangeToTimelineBlocks(layout, segment.start, segment.end);
        const selected = segment.id === selectedId;
        const hidden = segment.mode === "hidden";
        const className = [
          styles.block,
          hidden ? styles.hidden : "",
          selected ? styles.selected : "",
        ]
          .filter(Boolean)
          .join(" ");
        const nodes = blocks.map((block, i) => (
          <button
            key={`${segment.id}-${i}`}
            type="button"
            className={className}
            style={{
              left: `${timeToFraction(block.timelineStart, duration) * 100}%`,
              width: `${timeToFraction(block.timelineEnd - block.timelineStart, duration) * 100}%`,
            }}
            data-webcam-id={segment.id}
            data-mode={segment.mode}
            aria-label={t("webcamSegmentTitle", { n: index + 1 })}
            aria-pressed={selected}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(segment.id);
            }}
          >
            {hidden && <EyeOff size={10} className={styles.icon} />}
            <span className={styles.label}>{hidden ? t("webcamHidden") : t("webcamOverride")}</span>
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
});
