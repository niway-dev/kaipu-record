/**
 * Privacy lane (UI spec § 6.4) — one block per visible piece of each blur/cover region,
 * same selection and edge-drag contract as the Zooms lane. While a region is being drawn
 * the page passes `ghost` and a dashed "NEW BLUR / NEW COVER" block shows its window.
 */
import { useRef } from "react";
import { Droplet, RectangleHorizontal } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { Redaction } from "../privacy/redaction";
import { sourceRangeToTimelineBlocks, sourceTimeAtTimeline } from "../source-time";
import { type LayoutEntry, layoutDuration } from "../timeline";
import { fractionToTime, timeToFraction } from "./timeline-geometry";
import type { EdgePhase } from "./zoom-lane";
import styles from "./privacy-lane.module.css";

export interface PrivacyLaneProps {
  redactions: Redaction[];
  layout: LayoutEntry[];
  selectedId: string | null;
  onSelect(id: string): void;
  onEdgeDrag(id: string, edge: "start" | "end", sourceTime: number | null, phase: EdgePhase): void;
  ghost: { kind: "blur" | "cover"; start: number; end: number } | null;
}

export function PrivacyLane({
  redactions,
  layout,
  selectedId,
  onSelect,
  onEdgeDrag,
  ghost,
}: PrivacyLaneProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const laneRef = useRef<HTMLDivElement | null>(null);
  const dragEdge = useRef<{ id: string; edge: "start" | "end" } | null>(null);
  const duration = layoutDuration(layout);
  const pos = (start: number, end: number): React.CSSProperties => ({
    left: `${timeToFraction(start, duration) * 100}%`,
    width: `${timeToFraction(end - start, duration) * 100}%`,
  });

  const sourceFromPointer = (clientX: number): number | null => {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return sourceTimeAtTimeline(
      layout,
      fractionToTime((clientX - rect.left) / rect.width, duration),
    );
  };

  const handle = (r: Redaction, edge: "start" | "end", timelineAt: number) => {
    // A pointer gesture can end without a pointerup (system gesture, capture stolen, the
    // handle unmounting mid-drag) — same abort contract as ZoomLane's handle.
    const abort = (): void => {
      if (!dragEdge.current) return;
      dragEdge.current = null;
      onEdgeDrag(r.id, edge, null, "end");
    };
    return (
      <div
        key={`${r.id}-${edge}`}
        className={styles.handle}
        style={{ left: `calc(${timeToFraction(timelineAt, duration) * 100}% - 3px)` }}
        data-privacy-handle={edge}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          dragEdge.current = { id: r.id, edge };
          onEdgeDrag(r.id, edge, edge === "start" ? r.start : r.end, "start");
        }}
        onPointerMove={(event) => {
          event.stopPropagation();
          const drag = dragEdge.current;
          if (!drag || drag.id !== r.id || drag.edge !== edge) return;
          onEdgeDrag(r.id, edge, sourceFromPointer(event.clientX), "move");
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
    <div ref={laneRef} className={styles.lane} data-testid="privacy-lane">
      {redactions.flatMap((r) => {
        const blocks = sourceRangeToTimelineBlocks(layout, r.start, r.end);
        const selected = r.id === selectedId;
        const Icon = r.kind === "blur" ? Droplet : RectangleHorizontal;
        const label = r.kind === "blur" ? t("blurBadge") : r.label || t("coverBadge");
        const nodes = blocks.map((block, i) => (
          <button
            key={`${r.id}-${i}`}
            type="button"
            data-redaction-block={r.id}
            className={[
              styles.block,
              r.kind === "blur" ? styles.blur : styles.cover,
              selected && styles.selected,
            ]
              .filter(Boolean)
              .join(" ")}
            style={pos(block.timelineStart, block.timelineEnd)}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(r.id);
            }}
          >
            <Icon size={10} />
            <span className={styles.text}>{label}</span>
          </button>
        ));
        if (selected && blocks.length > 0) {
          const first = blocks[0];
          const last = blocks[blocks.length - 1];
          if (first.sourceStart === r.start) nodes.push(handle(r, "start", first.timelineStart));
          if (last.sourceEnd === r.end) nodes.push(handle(r, "end", last.timelineEnd));
        }
        return nodes;
      })}
      {ghost &&
        sourceRangeToTimelineBlocks(layout, ghost.start, ghost.end).map((block, i) => (
          <span
            key={`ghost-${i}`}
            className={styles.ghost}
            style={pos(block.timelineStart, block.timelineEnd)}
          >
            {ghost.kind === "blur" ? t("ghostBlur") : t("ghostCover")}
          </span>
        ))}
    </div>
  );
}
