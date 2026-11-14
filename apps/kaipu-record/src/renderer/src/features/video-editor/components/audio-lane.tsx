/**
 * Audio lane — one block per VISIBLE piece of each muted range (source-anchored,
 * like the zoom and privacy lanes). Click selects; the selected range shows an
 * edge handle wherever its real start or end is on screen.
 *
 * When the whole recording is muted the lane says so across its full width
 * instead of drawing the ranges: they still exist and come back when the
 * whole-video mute is turned off, but nothing in that state is editable, and
 * showing editable-looking blocks that do nothing would be a lie.
 *
 * With a waveform, the bars sit under everything else: under the hatched blocks, which
 * dim the bars they cover, and under the whole-recording-muted overlay, which dims all of
 * them.
 */
import { memo, useRef } from "react";
import { VolumeX } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";

import { sourceRangeToTimelineBlocks, sourceTimeAtTimeline } from "../source-time";
import { type LayoutEntry, layoutDuration } from "../timeline";
import type { MutedRange } from "../audio-edits";
import type { AudioPeaks } from "../use-audio-peaks";
import { AudioWaveform } from "./audio-waveform";
import { timeToFraction } from "./timeline-geometry";
import { useTimelinePointer } from "./timeline-pointer";
import styles from "./audio-lane.module.css";
import { uiArea } from "@renderer/lib/ui-area";

export interface AudioLaneProps {
  ranges: MutedRange[];
  layout: LayoutEntry[];
  /** The whole recording is silent; the ranges are kept but not shown. */
  audioMuted: boolean;
  /**
   * The recording's loudness peaks, drawn as bars behind the blocks (NIW2-775). Null when
   * the recording has no audio, or decoding failed: the lane then shows its empty-state text.
   */
  waveform?: AudioPeaks | null;
  selectedId: string | null;
  onSelect(id: string): void;
  onEdgeDrag(
    id: string,
    edge: "start" | "end",
    sourceTime: number | null,
    phase: "start" | "move" | "end",
  ): void;
}

export const AudioLane = memo(function AudioLane({
  ranges,
  layout,
  audioMuted,
  waveform,
  selectedId,
  onSelect,
  onEdgeDrag,
}: AudioLaneProps): React.JSX.Element {
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

  const handle = (range: MutedRange, edge: "start" | "end", timelineAt: number) => {
    // A gesture can end without a pointerup (system gesture, stolen capture, the
    // handle unmounting mid-drag). Without this the controller stays
    // `interacting` forever and every later commit silently no-ops — the same
    // abort contract the zoom lane uses.
    const abort = (): void => {
      if (!dragEdge.current) return;
      dragEdge.current = null;
      onEdgeDrag(range.id, edge, null, "end");
    };
    return (
      <div
        key={`${range.id}-${edge}`}
        className={styles.handle}
        style={{ left: `calc(${timeToFraction(timelineAt, duration) * 100}% - 3px)` }}
        data-mute-handle={edge}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          dragEdge.current = { id: range.id, edge };
          onEdgeDrag(
            range.id,
            edge,
            edge === "start" ? range.sourceStart : range.sourceEnd,
            "start",
          );
        }}
        onPointerMove={(event) => {
          event.stopPropagation();
          const drag = dragEdge.current;
          if (!drag || drag.id !== range.id || drag.edge !== edge) return;
          onEdgeDrag(range.id, edge, sourceFromPointer(event.clientX), "move");
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

  const wave =
    waveform && waveform.filled > 0 ? (
      <AudioWaveform
        waveform={waveform}
        layout={layout}
        mutedRanges={ranges}
        audioMuted={audioMuted}
      />
    ) : null;

  if (audioMuted) {
    return (
      <div
        ref={laneRef}
        {...uiArea("editorVideo.audioLane")}
        className={styles.lane}
        data-testid="audio-lane"
      >
        {wave}
        <p className={styles.allMuted}>
          <VolumeX size={12} /> {t("audioAllMuted")}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={laneRef}
      {...uiArea("editorVideo.audioLane")}
      className={styles.lane}
      data-testid="audio-lane"
    >
      {wave}
      {ranges.length === 0 && !wave && <p className={styles.empty}>{t("audioEmptyState")}</p>}
      {ranges.flatMap((range, index) => {
        const blocks = sourceRangeToTimelineBlocks(layout, range.sourceStart, range.sourceEnd);
        const selected = range.id === selectedId;
        const nodes = blocks.map((block, i) => (
          <button
            key={`${range.id}-${i}`}
            type="button"
            className={selected ? `${styles.block} ${styles.selected}` : styles.block}
            style={{
              left: `${timeToFraction(block.timelineStart, duration) * 100}%`,
              width: `${timeToFraction(block.timelineEnd - block.timelineStart, duration) * 100}%`,
            }}
            data-mute-id={range.id}
            // Every piece of a split range carries the same name and pressed
            // state: they are one range, not several.
            aria-label={t("muteTitle", { n: index + 1 })}
            aria-pressed={selected}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(range.id);
            }}
          >
            <VolumeX size={11} />
          </button>
        ));
        if (selected && blocks.length > 0) {
          const first = blocks[0]!;
          const last = blocks[blocks.length - 1]!;
          if (first.sourceStart === range.sourceStart)
            nodes.push(handle(range, "start", first.timelineStart));
          if (last.sourceEnd === range.sourceEnd)
            nodes.push(handle(range, "end", last.timelineEnd));
        }
        return nodes;
      })}
    </div>
  );
});
