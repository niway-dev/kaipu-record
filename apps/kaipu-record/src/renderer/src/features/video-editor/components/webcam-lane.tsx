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
 * Every stretch is drawn as wide as it lasts (spec decision 12): a part never borrows width
 * from what follows it. Below 3 px a part is drawn 3 px so it never vanishes; what does not fit
 * is not drawn (the frame, the name and the arrival word drop out as the part narrows). A part
 * or hidden range under 12 px keeps a 12 px click target around it, and hovering any stretch
 * shows a card with its details (decision 16).
 *
 * Under the stretches runs a filmstrip of the webcam file's own frames, laid out per clip
 * like the clips lane, so the row reads as "the face" even with no segment on it.
 */
import { memo, useEffect, useRef, useState } from "react";
import { EyeOff } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { sourceRangeToTimelineBlocks, sourceTimeAtTimeline } from "../source-time";
import { type LayoutEntry, layoutDuration } from "../timeline";
import type { ClipRecordings } from "../clip-recordings";
import type { CompanionThumbnails, CoveredRange, SourceThumbnail } from "../use-source-thumbnails";
import {
  NOMINAL_LANE_FRAME,
  webcamHandleShift,
  webcamLanePieceAt,
  webcamLanePlacements,
  webcamLaneStretches,
  webcamLaneTargets,
  webcamPartSlideSeconds,
  webcamStretchCard,
  webcamStretchDot,
  webcamStretchName,
  type WebcamStretch,
} from "../webcam/webcam-stretches";
import type { FrameSize } from "../webcam/webcam-layout";
import { NAME_LABEL } from "./webcam-name-label";
import { WebcamLaneCard, type CardAnchor } from "./webcam-lane-card";
import { WEBCAM_DEFAULTS, type WebcamLayout, type WebcamSegment } from "../webcam/webcam-model";
import { thumbnailAt, thumbnailTiles, timeToFraction } from "./timeline-geometry";
import { FilmstripTiles } from "./filmstrip-tiles";
import {
  useTimelinePointer,
  useTimelineShowRange,
  useTimelineViewContext,
} from "./timeline-pointer";
import { scaleOf, visibleRange } from "./timeline-view";
import type { EdgePhase } from "./zoom-lane";
import styles from "./webcam-lane.module.css";
import { uiArea } from "@renderer/lib/ui-area";

/** No known range: every tile gets its nearest frame. */
const ALL_SOURCE: CoveredRange = { start: -Infinity, end: Infinity };

/** With `zoom-filmstrip` on: the webcam file a recording's clips draw from, and where it starts. */
export interface WebcamFilmstripFile {
  fileKey: string;
  /** The webcam file's start offset against its recording's own time (ADR 0037), in seconds. */
  companionOffset: number;
}

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
  /** Clips (by item id) whose recording has no camera while another recording of the scene does
   *  (ADR 0058): their stretch of the lane reads "No camera in this recording". */
  noCameraItemIds?: ReadonlySet<string>;
  /** Which recording each clip reads (ADR 0058); null/absent without joined recordings. */
  clipRecordings?: ClipRecordings | null;
  /** Each JOINED recording's webcam frames by `SceneSource.id`, at the recording's own time. A
   *  joined clip draws from its recording's strip only: never from `thumbnails`. */
  recordingStrips?: ReadonlyMap<string, CompanionThumbnails>;
  /** The webcam files by `SceneSource.id` (null is the opened recording). Absent with the flag
   *  off: tiles draw as they always did. */
  filmstripFiles?: ReadonlyMap<string | null, WebcamFilmstripFile>;
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
/**
 * Narrower than this (px) a slide's wedge cannot be told from the block, so it is not drawn;
 * a cut's bar and a hidden range's icon follow the same idea (the icon needs its own 16 px).
 */
const WEDGE_MIN_PX = 6;
const ICON_ROOM_PX = 16;
/** The pointer rests this long (ms) on the lane before its card appears. */
const CARD_DELAY_MS = 120;

/** What the card is showing: which piece, where, and since when the pointer has rested. */
interface Hover {
  /** The piece's key: a part's or hidden range's id, `original-<start>` for an original. */
  key: string;
  anchor: CardAnchor;
  /** The view the anchor was measured in: a scroll or a zoom makes the card stale. */
  viewKey: string;
  shown: boolean;
}

/** Keyboard focus, not the focus a mouse click leaves behind (an engine without the selector: any). */
function focusIsVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

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
  noCameraItemIds,
  clipRecordings = null,
  recordingStrips,
  filmstripFiles,
  selectedId,
  pendingPart = null,
  onSelect,
  onEdgeDrag,
}: WebcamLaneProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const laneRef = useRef<HTMLDivElement | null>(null);
  // `offset` is the seconds between the pointer and the edge when it was grabbed: a handle
  // drawn shifted off its edge must not move the edge until the pointer does.
  const dragEdge = useRef<{ id: string; edge: "start" | "end"; offset: number } | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const cardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHover = (): void => {
    if (cardTimer.current) clearTimeout(cardTimer.current);
    cardTimer.current = null;
    setHover(null);
  };
  useEffect(
    () => () => {
      if (cardTimer.current) clearTimeout(cardTimer.current);
    },
    [],
  );
  const duration = layoutDuration(layout);

  // The pointer's SOURCE time, through the strip's one pixel-to-time conversion (it knows
  // the zoom and the scroll; this lane does not). Null over a slide or while unmeasured.
  const timeAtPointer = useTimelinePointer(laneRef, duration);
  const sourceFromPointer = (clientX: number, offset = 0): number | null => {
    const at = timeAtPointer(clientX);
    if (at === null) return null;
    return sourceTimeAtTimeline(layout, Math.min(duration, Math.max(0, at + offset)));
  };

  const handle = (
    segment: WebcamSegment,
    edge: "start" | "end",
    timelineAt: number,
    shiftPx: number,
  ) => {
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
        style={{
          // Centred on the real edge (the 6 px handle's own half-width), or moved outward so a
          // narrow part's two handles stay apart: the shift is a margin, in px, whatever the zoom.
          left: `${timeToFraction(timelineAt, duration) * 100}%`,
          marginLeft: -3 + (edge === "start" ? -shiftPx : shiftPx),
        }}
        data-webcam-handle={edge}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          const at = timeAtPointer(event.clientX);
          dragEdge.current = { id: segment.id, edge, offset: at === null ? 0 : timelineAt - at };
          clearHover();
          onEdgeDrag(segment.id, edge, edge === "start" ? segment.start : segment.end, "start");
        }}
        onPointerMove={(event) => {
          event.stopPropagation();
          const drag = dragEdge.current;
          if (!drag) {
            trackHover(event.clientX); // a handle is part of the lane: the card follows over it
            return;
          }
          if (drag.id !== segment.id || drag.edge !== edge) return;
          onEdgeDrag(segment.id, edge, sourceFromPointer(event.clientX, drag.offset), "move");
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
  const showRange = useTimelineShowRange();
  const scale = view
    ? scaleOf(view)
    : duration > 0
      ? (laneRef.current?.clientWidth ?? 800) / duration
      : 0;
  const shown = view && scale > 0 ? visibleRange(view) : { start: 0, end: duration };
  const range = covered ?? ALL_SOURCE;
  const filmstrip =
    thumbnails.length > 0 || (recordingStrips?.size ?? 0) > 0 ? (
      // Decoration only: the segments above carry every interaction and accessible name.
      <div className={styles.filmstrip} data-webcam-filmstrip aria-hidden="true">
        {layout.map((entry) => {
          if (entry.kind !== "clip") return null; // a slide has no webcam
          // A joined clip reads its own recording's camera at the recording's local time
          // (axis time - its range offset); the opened recording's clips read `thumbnails`.
          const recording = clipRecordings?.get(entry.itemId);
          const joined = recording && recording.sourceId !== null;
          const strip = joined ? recordingStrips?.get(recording.sourceId!) : undefined;
          const frames = joined ? (strip?.thumbnails ?? []) : thumbnails;
          const frameRange = joined ? (strip?.covered ?? ALL_SOURCE) : range;
          const shift = joined ? recording.offset : 0;
          const filmstrip = filmstripFiles?.get(joined ? recording.sourceId : null);
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
              {filmstrip ? (
                <FilmstripTiles
                  tiles={tiles}
                  entry={entry}
                  binding={{
                    fileKey: filmstrip.fileKey,
                    fileOffset: shift + filmstrip.companionOffset,
                    legacyOffset: filmstrip.companionOffset,
                  }}
                  legacy={frames}
                  covered={frameRange}
                  className={styles.tile}
                />
              ) : (
                tiles.map((tile) => {
                  // A tile outside the file's footage stays empty: it must not borrow a frame.
                  const thumb = thumbnailAt(frames, tile.sourceTime - shift, frameRange);
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
                })
              )}
            </div>
          );
        })}
      </div>
    ) : null;

  // The stretches of the whole recording, cut into the pieces the layout shows, left to right,
  // and where each is really drawn (as wide as it lasts) and clicked (a 12 px target at least).
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
  // Where each clip ends on the timeline: a part's floor width is never drawn past it.
  const clipEnds = new Map<string, number>();
  for (const entry of layout) {
    if (entry.kind === "clip") clipEnds.set(entry.itemId, entry.timelineEnd * pxPerSecond);
  }
  const lanePieces = pieces.map((piece) => ({
    kind: piece.stretch.kind,
    left: piece.block.timelineStart * pxPerSecond,
    right: piece.block.timelineEnd * pxPerSecond,
    clipRight: clipEnds.get(piece.block.itemId),
  }));
  const placements = webcamLanePlacements(lanePieces, totalPx);
  const targets = webcamLaneTargets(lanePieces, placements, totalPx);
  const pieceKey = (stretch: WebcamStretch, i: number): string =>
    stretch.kind === "original" ? `original-${stretch.start}-${i}` : stretch.id;
  const viewKey = view ? `${view.zoom}:${view.scroll}` : "";

  /** The card follows the pointer over the lane; the stretch is found by the click rule. */
  const showCardFor = (index: number, clientX: number, now: boolean): void => {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect) return;
    const piece = pieces[index]!;
    const left = view && scale > 0 ? rect.left + shown.start * scale : 0;
    const right = view && scale > 0 ? rect.left + shown.end * scale : window.innerWidth;
    const next: Hover = {
      key: pieceKey(piece.stretch, index),
      anchor: { clientX, laneTop: rect.top, laneBottom: rect.bottom, left, right },
      viewKey,
      shown: now,
    };
    setHover((current) => {
      // Already showing: moving to another stretch swaps the card at once.
      const keep = current !== null && current.shown && current.viewKey === viewKey;
      return { ...next, shown: now || keep };
    });
    if (!now && !cardTimer.current) {
      cardTimer.current = setTimeout(() => {
        cardTimer.current = null;
        setHover((current) => (current ? { ...current, shown: true } : current));
      }, CARD_DELAY_MS);
    }
  };
  const trackHover = (clientX: number): void => {
    if (dragEdge.current) return;
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect) return;
    const at = webcamLanePieceAt(lanePieces, placements, targets, clientX - rect.left);
    if (at === null) clearHover();
    else showCardFor(at, clientX, false);
  };
  const selectedSegment: WebcamSegment | null =
    segments.find((segment) => segment.id === selectedId) ?? null;

  const hovered =
    hover && hover.shown && hover.viewKey === viewKey
      ? pieces.findIndex((piece, i) => pieceKey(piece.stretch, i) === hover.key)
      : -1;

  return (
    <div
      ref={laneRef}
      {...uiArea("editorVideo.webcamLane")}
      className={styles.lane}
      data-testid="webcam-lane"
      onPointerMove={(event) => trackHover(event.clientX)}
      onPointerLeave={clearHover}
    >
      {filmstrip}
      {noCameraItemIds &&
        layout
          .filter((entry) => noCameraItemIds.has(entry.itemId))
          .map((entry) => (
            <div
              key={entry.itemId}
              className={styles.noCamera}
              data-testid="no-camera-span"
              style={{
                left: `${timeToFraction(entry.timelineStart, duration) * 100}%`,
                width: `${timeToFraction(entry.timelineEnd - entry.timelineStart, duration) * 100}%`,
              }}
            >
              <span className={styles.noCameraLabel}>{t("noCameraInRecording")}</span>
            </div>
          ))}
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
        // A slide's wedge is as long as the slide and never longer than the part; too short to
        // be told from the block, it is not drawn (and neither is a cut's bar).
        const wedgePx = slide === null ? 0 : Math.min(slide * pxPerSecond, place.width);
        const wedge = slide !== null && wedgePx >= WEDGE_MIN_PX;
        const cutBar = slide === null && place.width >= WEDGE_MIN_PX;
        // The click target: the drawn box, or 12 px around it when it is narrower. The drawn
        // box sits inside it, placed in percent of the target.
        const target = targets[i]!;
        const targetStyle = {
          left: `${(target.left / totalPx) * 100}%`,
          width: `${(target.width / totalPx) * 100}%`,
        };
        const fillStyle = {
          left: `${((place.left - target.left) / target.width) * 100}%`,
          width: `${(place.width / target.width) * 100}%`,
        };
        const key = pieceKey(stretch, i);
        return (
          <button
            key={`${segment.id}-${piece.index}`}
            type="button"
            className={`${styles.target} ${selected ? styles.targetSelected : ""}`}
            style={targetStyle}
            data-webcam-id={segment.id}
            data-mode={segment.mode}
            aria-label={t("webcamSegmentTitle", { n: index + 1 })}
            aria-pressed={selected}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(segment.id);
            }}
            onDoubleClick={(event) => {
              // The first click already selected it; this one zooms to the whole part (or hidden
              // range), across the cuts that split it into several pieces.
              event.stopPropagation();
              const mine = pieces.filter(
                (p) => p.stretch.kind !== "original" && p.stretch.id === segment.id,
              );
              showRange?.(
                Math.min(...mine.map((p) => p.block.timelineStart)),
                Math.max(...mine.map((p) => p.block.timelineEnd)),
              );
            }}
            onFocus={(event) => {
              // Keyboard focus shows the same card at once, over the middle of the target.
              if (!focusIsVisible(event.currentTarget)) return;
              const box = event.currentTarget.getBoundingClientRect();
              showCardFor(i, box.left + box.width / 2, true);
            }}
            onBlur={() => setHover((current) => (current?.key === key ? null : current))}
          >
            <span className={className} style={fillStyle} data-webcam-fill>
              {!hidden && atStart && wedge && (
                <span
                  className={styles.wedge}
                  data-webcam-transition
                  style={{ width: wedgePx }}
                  aria-hidden="true"
                />
              )}
              {!hidden && atStart && cutBar && (
                <span className={styles.cutBar} data-webcam-cut aria-hidden="true" />
              )}
              {hidden ? (
                <>
                  {place.width >= ICON_ROOM_PX && <EyeOff size={12} className={styles.icon} />}
                  {place.width > ROOM_GLYPH_PX && (
                    <span className={styles.label}>{t("webcamHidden")}</span>
                  )}
                </>
              ) : (
                <span
                  className={styles.partContent}
                  style={{ paddingLeft: atStart && wedge ? wedgePx + 7 : 7 }}
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
            </span>
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
          // The handles drag the real edges; a part under 10 px wide has them drawn apart.
          const shift = webcamHandleShift((last.timelineEnd - first.timelineStart) * pxPerSecond);
          return (
            <>
              {first.sourceStart === selectedSegment.start &&
                handle(selectedSegment, "start", first.timelineStart, shift)}
              {last.sourceEnd === selectedSegment.end &&
                handle(selectedSegment, "end", last.timelineEnd, shift)}
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
      {hovered >= 0 && hover && (
        <WebcamLaneCard
          card={webcamStretchCard(webcam, pieces[hovered]!.stretch, frame)}
          glyph={
            <Glyph
              dot={webcamStretchDot(webcam, pieces[hovered]!.stretch, frame)}
              on={pieces[hovered]!.stretch.kind === "part"}
            />
          }
          anchor={hover.anchor}
        />
      )}
    </div>
  );
});
