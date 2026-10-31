/**
 * Webcam lane (ADR 0038): one block per VISIBLE piece of each hide/override segment,
 * source-anchored like the zoom lane, whose patterns it follows — click selects the whole
 * segment, the selected segment shows an edge handle only where its real start/end is
 * visible, and edge drags report SOURCE time (null over a slide) with the start/move/end
 * phase contract. Hidden segments are striped; overrides read "Custom". Deleting goes
 * through the inspector or the Delete key, like every other lane.
 */
import { useRef } from "react";
import { EyeOff } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { sourceRangeToTimelineBlocks, sourceTimeAtTimeline } from "../source-time";
import { type LayoutEntry, layoutDuration } from "../timeline";
import type { WebcamSegment } from "../webcam/webcam-model";
import { fractionToTime, timeToFraction } from "./timeline-geometry";
import type { EdgePhase } from "./zoom-lane";
import styles from "./webcam-lane.module.css";

export interface WebcamLaneProps {
  segments: WebcamSegment[];
  layout: LayoutEntry[];
  selectedId: string | null;
  onSelect(id: string): void;
  /** `sourceTime` is null when the pointer is over a slide — ignore that move. */
  onEdgeDrag(id: string, edge: "start" | "end", sourceTime: number | null, phase: EdgePhase): void;
}

export function WebcamLane({
  segments,
  layout,
  selectedId,
  onSelect,
  onEdgeDrag,
}: WebcamLaneProps): React.JSX.Element {
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

  return (
    <div ref={laneRef} className={styles.lane} data-testid="webcam-lane">
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
}
