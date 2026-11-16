/**
 * Webcam lane (ADR 0038, camera parts): EVERY stretch of the recording is drawn, source-anchored
 * like the zoom lane, whose patterns it follows. The default position fills the gaps as dashed
 * "original" stretches that cannot be selected; a part is an accent block with a small frame
 * showing where the camera is, its name and how it arrives (a light wedge as long as its slide,
 * or a thin bar for a cut); a hidden range is striped with an eye-off icon. Clicking a part or a
 * hidden range selects it; the selected one shows an edge handle only where its real start/end
 * is visible, and edge drags report SOURCE time (null over a slide) with the start/move/end
 * phase contract. Deleting goes through the inspector or the Delete key, like every other lane.
 *
 * A part is drawn at least 56 px wide, never over its neighbour (`webcamLaneBlockWidths`).
 *
 * Under the stretches runs a filmstrip of the webcam file's own frames, laid out per clip
 * like the clips lane, so the row reads as "the face" even with no segment on it.
 */
import { memo, useRef } from "react";
import { EyeOff } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { sourceRangeToTimelineBlocks, sourceTimeAtTimeline } from "../source-time";
import { type LayoutEntry, layoutDuration } from "../timeline";
import type { CoveredRange, SourceThumbnail } from "../use-source-thumbnails";
import {
  NOMINAL_LANE_FRAME,
  webcamLaneBlockWidths,
  webcamLaneStretches,
  webcamPartSlideSeconds,
  webcamStretchDot,
  webcamStretchName,
  type WebcamStretch,
} from "../webcam/webcam-stretches";
import type { FrameSize } from "../webcam/webcam-layout";
import { NAME_LABEL } from "./webcam-name-label";
import { WEBCAM_DEFAULTS, type WebcamLayout, type WebcamSegment } from "../webcam/webcam-model";
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
  /**
   * The default layout: the original stretches show its position and every part its own over
   * it. Absent, the built-in defaults (a lane drawn with no scene, as the guide does).
   */
  defaultLayout?: WebcamLayout;
  /** The output frame the places are in, for the names; a 16:9 frame until it is measured. */
  frame?: FrameSize;
  selectedId: string | null;
  /** The window a part would take while the drop card is open, in SOURCE time: a dashed block. */
  pendingPart?: { start: number; end: number } | null;
  onSelect(id: string): void;
  /** `sourceTime` is null when the pointer is over a slide — ignore that move. */
  onEdgeDrag(id: string, edge: "start" | "end", sourceTime: number | null, phase: EdgePhase): void;
}

/** A block this wide (px) has room for the small frame, the name, and the words. */
const ROOM_GLYPH_PX = 46;
const ROOM_NAME_PX = 110;
const ROOM_ORIGINAL_WORD_PX = 190;
const ROOM_HOW_PX = 200;
/** The lane's width when nothing measures it (a test, the first paint): only proportions matter. */
const UNMEASURED_LANE_PX = 800;
/** The wedge of a slide is at least this wide, so a short slide still reads. */
const WEDGE_MIN_PX = 10;

/** 0.7, 1.2, 0.35: the seconds as short as they can be written. */
const seconds = (value: number): string => String(Number(value.toFixed(2)));

/** The small frame with a dot where the camera is. `dot` is each axis's share, 0 to 1. */
function Glyph({
  dot,
  on,
}: {
  dot: { x: number; y: number } | null;
  on: boolean;
}): React.JSX.Element | null {
  if (!dot) return null;
  return (
    <span
      className={`${styles.glyph} ${on ? styles.glyphOn : ""}`}
      data-webcam-glyph
      aria-hidden="true"
    >
      <span className={styles.glyphDot} style={{ left: 2 + dot.x * 16, top: 2 + dot.y * 6 }} />
    </span>
  );
}

export const WebcamLane = memo(function WebcamLane({
  segments,
  layout,
  thumbnails = [],
  covered = null,
  defaultLayout = WEBCAM_DEFAULTS,
  frame = NOMINAL_LANE_FRAME,
  selectedId,
  pendingPart = null,
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

  // The stretches of the whole recording, cut into the pieces the layout shows, left to right,
  // and where each is really drawn: a part is at least 56 px wide, never over its neighbour.
  const sourceDuration = layout.reduce(
    (end, entry) => (entry.kind === "clip" ? Math.max(end, entry.sourceEnd) : end),
    0,
  );
  const webcam = { layout: defaultLayout, segments };
  const pxPerSecond = scale > 0 ? scale : duration > 0 ? UNMEASURED_LANE_PX / duration : 0;
  const totalPx = duration * pxPerSecond;
  const pieces = webcamLaneStretches(webcam, sourceDuration)
    .flatMap((stretch: WebcamStretch) =>
      sourceRangeToTimelineBlocks(layout, stretch.start, stretch.end).map((block, index) => ({
        stretch,
        block,
        index,
        first: index === 0,
      })),
    )
    .sort((a, b) => a.block.timelineStart - b.block.timelineStart);
  const placements = webcamLaneBlockWidths(
    pieces.map((piece) => ({
      kind: piece.stretch.kind,
      left: piece.block.timelineStart * pxPerSecond,
      right: piece.block.timelineEnd * pxPerSecond,
    })),
    totalPx,
  );
  const selectedSegment: WebcamSegment | null =
    segments.find((segment) => segment.id === selectedId) ?? null;

  return (
    <div
      ref={laneRef}
      {...uiArea("editorVideo.webcamLane")}
      className={styles.lane}
      data-testid="webcam-lane"
    >
      {filmstrip}
      {pieces.map((piece, i) => {
        const place = placements[i]!;
        if (place.width <= 0) return null;
        const { stretch, first } = piece;
        const style = {
          left: `${(place.left / totalPx) * 100}%`,
          width: `${(place.width / totalPx) * 100}%`,
        };
        const name = webcamStretchName(webcam, stretch, frame);
        const nameText = name ? t(NAME_LABEL[name]) : null;
        const dot = webcamStretchDot(webcam, stretch, frame);
        if (stretch.kind === "original") {
          return (
            <span
              key={`original-${stretch.start}-${i}`}
              className={styles.original}
              style={style}
              data-webcam-original
              aria-hidden="true"
            >
              {place.width > ROOM_GLYPH_PX && <Glyph dot={dot} on={false} />}
              {place.width > ROOM_NAME_PX && <span className={styles.name}>{nameText}</span>}
              {place.width > ROOM_ORIGINAL_WORD_PX && (
                <span className={styles.word}>{t("webcamLaneOriginal")}</span>
              )}
            </span>
          );
        }
        const segment = segments.find((s) => s.id === stretch.id)!;
        const index = segments.indexOf(segment);
        const selected = segment.id === selectedId;
        const hidden = stretch.kind === "hidden";
        const className = [
          styles.block,
          hidden ? styles.hidden : styles.part,
          selected ? styles.selected : "",
        ]
          .filter(Boolean)
          .join(" ");
        const slide = webcamPartSlideSeconds(segment);
        // The slide or the cut belongs to the part's real start, on the piece that holds it.
        const atStart = first && piece.block.sourceStart === segment.start;
        const wedgePx = slide === null ? 0 : Math.max(WEDGE_MIN_PX, slide * pxPerSecond);
        return (
          <button
            key={`${segment.id}-${piece.index}`}
            type="button"
            className={className}
            style={style}
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
            {!hidden && atStart && slide !== null && (
              <span
                className={styles.wedge}
                data-webcam-transition
                style={{ width: wedgePx }}
                aria-hidden="true"
              />
            )}
            {!hidden && atStart && slide === null && (
              <span className={styles.cutBar} data-webcam-cut aria-hidden="true" />
            )}
            {hidden ? (
              <>
                <EyeOff size={12} className={styles.icon} />
                {place.width > ROOM_GLYPH_PX && (
                  <span className={styles.label}>{t("webcamHidden")}</span>
                )}
              </>
            ) : (
              <span
                className={styles.partContent}
                style={{ paddingLeft: atStart ? (slide === null ? 7 : wedgePx + 7) : 7 }}
              >
                {place.width > ROOM_GLYPH_PX && <Glyph dot={dot} on />}
                {place.width > ROOM_NAME_PX && <span className={styles.name}>{nameText}</span>}
                {place.width > ROOM_HOW_PX && (
                  <span className={styles.word}>
                    {slide === null
                      ? t("webcamLaneCut")
                      : t("webcamLaneSlide", { seconds: seconds(slide) })}
                  </span>
                )}
              </span>
            )}
          </button>
        );
      })}
      {selectedSegment &&
        (() => {
          const blocks = sourceRangeToTimelineBlocks(
            layout,
            selectedSegment.start,
            selectedSegment.end,
          );
          if (blocks.length === 0) return null;
          const first = blocks[0]!;
          const last = blocks[blocks.length - 1]!;
          return (
            <>
              {first.sourceStart === selectedSegment.start &&
                handle(selectedSegment, "start", first.timelineStart)}
              {last.sourceEnd === selectedSegment.end &&
                handle(selectedSegment, "end", last.timelineEnd)}
            </>
          );
        })()}
      {pendingPart &&
        sourceRangeToTimelineBlocks(layout, pendingPart.start, pendingPart.end).map((block, i) => (
          <span
            key={`pending-${i}`}
            className={styles.pending}
            style={{
              left: `${timeToFraction(block.timelineStart, duration) * 100}%`,
              width: `${timeToFraction(block.timelineEnd - block.timelineStart, duration) * 100}%`,
            }}
            data-webcam-pending
            aria-hidden="true"
          >
            {i === 0 && (
              <span className={styles.label}>
                {t("webcamPendingPart", {
                  seconds: Math.round(pendingPart.end - pendingPart.start),
                })}
              </span>
            )}
          </span>
        ))}
    </div>
  );
});
