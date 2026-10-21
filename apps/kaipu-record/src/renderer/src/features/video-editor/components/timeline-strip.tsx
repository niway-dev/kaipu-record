import { useCallback, useEffect, useRef, type ReactElement } from "react";
import { ImagePlus } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { PreviewPlayback } from "../use-preview-playback";
import type { LayoutEntry } from "../timeline";
import { layoutDuration } from "../timeline";
import type { VideoOverlay } from "../scene";
import type { SourceThumbnail } from "../use-source-thumbnails";
import { OverlayLane, type WindowChangePhase } from "./overlay-lane";
import {
  fractionToTime,
  rulerTicks,
  thumbnailsForRange,
  timeToFraction,
} from "./timeline-geometry";
import styles from "./timeline-strip.module.css";

const THUMBS_PER_BLOCK_PX = 72; // one thumbnail tile roughly every 72px of block width

/** A lane stacked under the main track (Activity, Zooms, Privacy — video-editor v2). */
export interface ExtraLane {
  key: string;
  /** Short uppercase label for the label column. */
  label: string;
  /** A SINGLE element, not a ReactNode: .timelineBody is a two-column grid and
   *  auto-places one child per cell, so a lane rendering a fragment with two roots
   *  would push every following label and lane one cell along. LaneRow also wraps it
   *  in its own cell div, so neither mistake can reach the grid. */
  node: ReactElement;
}

export function TimelineStrip({
  layout,
  playback,
  thumbnails,
  selectedItemId,
  onSelectItem,
  onTrim,
  slideUrlFor,
  onSlideDuration,
  overlays,
  selectedOverlayId,
  onSelectOverlay,
  onWindowChange,
  extraLanes = [],
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
  /** Resolves a slide's image URL from its asset id so blocks can show their picture. */
  slideUrlFor?: (assetId: string) => string | null;
  /** Fired while dragging a slide's right-edge duration handle — same phase contract
   *  as onTrim so a whole drag collapses into one undo step. */
  onSlideDuration?: (itemId: string, duration: number, phase: "start" | "move" | "end") => void;
  /** Annotation overlays shown as pills on the lane above the main track. */
  overlays: VideoOverlay[];
  selectedOverlayId: string | null;
  onSelectOverlay: (id: string | null) => void;
  onWindowChange?: (id: string, start: number, end: number, phase: WindowChangePhase) => void;
  /** Lanes rendered below the main track, each with its label, in order. */
  extraLanes?: ExtraLane[];
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
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

  // Compute timeline time from a clientX coordinate relative to the given element.
  // The ruler and track span the same horizontal extent (no padding inside the
  // timelineBody wrapper), so either element's rect yields the same fraction → time
  // mapping. We read the ACTUAL receiving element to stay correct if layout changes.
  const timeFromPointerOnElement = useCallback(
    (clientX: number, el: Element | null): number => {
      const rect = el?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 0;
      return fractionToTime((clientX - rect.left) / rect.width, duration);
    },
    [duration],
  );

  // Track-relative shorthand — passed down to TrackBlock trim/slide-duration handlers
  // which receive { clientX } directly without a React event target reference.
  const timeFromPointer = useCallback(
    (event: { clientX: number }): number =>
      timeFromPointerOnElement(event.clientX, trackRef.current),
    [timeFromPointerOnElement],
  );

  // The ruler is the dedicated scrub surface. It sits in its own row ABOVE all clip
  // blocks, so it is always reachable no matter how the clips are laid out. Blocks
  // call stopPropagation on their own pointerdown to remain select-only; this ruler
  // row is never blocked by them. Scrubbing does NOT pause — the user can drag the
  // playhead while video plays and it keeps playing from the new position.
  const onRulerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      playback.seek(timeFromPointerOnElement(event.clientX, event.currentTarget));
    },
    [playback, timeFromPointerOnElement],
  );

  const onRulerPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      playback.seek(timeFromPointerOnElement(event.clientX, event.currentTarget));
    },
    [playback, timeFromPointerOnElement],
  );

  // The track background also handles scrub for clicks that land on empty track area
  // (between blocks). Consistent with the ruler: no forced pause — scrubbing keeps
  // playback running from the new point.
  const onTrackPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      playback.seek(timeFromPointerOnElement(event.clientX, event.currentTarget));
    },
    [playback, timeFromPointerOnElement],
  );

  const onTrackPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      playback.seek(timeFromPointerOnElement(event.clientX, event.currentTarget));
    },
    [playback, timeFromPointerOnElement],
  );

  return (
    <div className={styles.strip}>
      {/* timelineBody is a two-column grid: labels (--lane-label-w) + lanes. Every lane
          sits in column 2, so all lanes share one horizontal extent and the fraction →
          time mapping is identical on each. The playhead lives in its own layer
          spanning column 2 across every row (see .playheadLayer). */}
      <div className={styles.timelineBody}>
        <span className={styles.laneLabel} />
        <div
          data-testid="ruler"
          className={styles.ruler}
          onPointerDown={onRulerPointerDown}
          onPointerMove={onRulerPointerMove}
        >
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
        <span className={styles.laneLabel}>{t("laneAnnotations")}</span>
        <OverlayLane
          overlays={overlays}
          duration={duration}
          selectedOverlayId={selectedOverlayId}
          onSelectOverlay={onSelectOverlay}
          onWindowChange={(id, start, end, phase) => onWindowChange?.(id, start, end, phase)}
        />
        <span className={styles.laneLabel}>{t("laneClips")}</span>
        <div
          ref={trackRef}
          className={styles.track}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
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
              slideUrlFor={slideUrlFor}
              onSlideDuration={onSlideDuration}
            />
          ))}
        </div>
        {extraLanes.map((lane) => (
          <LaneRow key={lane.key} label={lane.label}>
            {lane.node}
          </LaneRow>
        ))}
        {/* Positioned via direct DOM mutation in the subscribeTime callback (avoid React
            re-renders at 60fps). The layer spans every row of the lanes column. */}
        <div className={styles.playheadLayer}>
          <div ref={playheadRef} className={styles.playhead} />
        </div>
      </div>
    </div>
  );
}

function LaneRow({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}): React.JSX.Element {
  return (
    <>
      <span className={styles.laneLabel}>{label}</span>
      {/* Exactly one grid cell, whatever the lane renders — the label/lane pairing of
          every row below this one depends on it. */}
      <div className={styles.laneCell}>{children}</div>
    </>
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
  slideUrlFor,
  onSlideDuration,
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
  slideUrlFor?: (assetId: string) => string | null;
  onSlideDuration?: (itemId: string, duration: number, phase: "start" | "move" | "end") => void;
}): React.JSX.Element {
  const blockRef = useRef<HTMLButtonElement | null>(null);
  const left = timeToFraction(entry.timelineStart, duration) * 100;
  const width = timeToFraction(entry.timelineEnd - entry.timelineStart, duration) * 100;
  const approxWidthPx = (width / 100) * (blockRef.current?.parentElement?.clientWidth ?? 800);
  const isSlide = entry.kind === "slide";
  const slideUrl = isSlide && entry.assetId ? (slideUrlFor?.(entry.assetId) ?? null) : null;
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

  // A slide has no source range to trim — its right handle sets the hold DURATION, so
  // it drags in timeline space: duration = pointer time − the slide's start. Same three
  // phases as trimHandlers so the page collapses the drag into one undo step.
  const slideDurationHandlers = (): {
    onPointerDown: React.PointerEventHandler<HTMLDivElement>;
    onPointerMove: React.PointerEventHandler<HTMLDivElement>;
    onPointerUp: React.PointerEventHandler<HTMLDivElement>;
  } => {
    const durationFromPointer = (event: { clientX: number }): number =>
      timeFromPointer(event) - entry.timelineStart;
    return {
      onPointerDown: (event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        onSlideDuration?.(entry.itemId, entry.timelineEnd - entry.timelineStart, "start");
      },
      onPointerMove: (event) => {
        event.stopPropagation();
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        onSlideDuration?.(entry.itemId, durationFromPointer(event), "move");
      },
      onPointerUp: (event) => {
        event.stopPropagation();
        onSlideDuration?.(entry.itemId, durationFromPointer(event), "end");
      },
    };
  };

  return (
    <>
      <button
        ref={blockRef}
        type="button"
        className={[styles.block, isSlide && styles.slideBlock, selected && styles.blockSelected]
          .filter(Boolean)
          .join(" ")}
        style={{ left: `${left}%`, width: `${width}%` }}
        onPointerDown={(event) => {
          // Stop the pointerdown from reaching the track background handler — a clip
          // click should only select, not also scrub the timeline.
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation(); // a block click selects; it must not also scrub
          onSelect();
        }}
      >
        {isSlide ? (
          <>
            {slideUrl && (
              <img src={slideUrl} alt="" className={styles.slideTile} draggable={false} />
            )}
            <span className={styles.slideBadge}>
              <ImagePlus size={14} />
            </span>
          </>
        ) : (
          tiles.map((tile, i) => (
            <img key={i} src={tile.url} alt="" className={styles.tile} draggable={false} />
          ))
        )}
      </button>
      {/* Rendered as siblings, not children of the button: the button clips its
          thumbnails with overflow:hidden, which would also clip a handle sitting
          half outside the block's edge. */}
      {selected && entry.kind === "clip" && (
        <>
          <div
            className={styles.trimHandle}
            style={{ left: `calc(${left}% - 4px)` }}
            data-trim-handle="start"
            {...trimHandlers("start")}
          />
          <div
            className={styles.trimHandle}
            style={{ left: `calc(${left + width}% - 4px)` }}
            data-trim-handle="end"
            {...trimHandlers("end")}
          />
        </>
      )}
      {/* Slides expose a single right-edge handle — the duration control. */}
      {selected && isSlide && (
        <div
          className={styles.trimHandle}
          style={{ left: `calc(${left + width}% - 4px)` }}
          data-slide-handle="end"
          {...slideDurationHandlers()}
        />
      )}
    </>
  );
}
