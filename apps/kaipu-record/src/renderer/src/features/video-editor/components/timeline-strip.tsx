import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactElement,
} from "react";
import { Film, ImagePlus, PenLine, type LucideIcon } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { PreviewPlayback } from "../use-preview-playback";
import type { LayoutEntry } from "../timeline";
import { layoutDuration } from "../timeline";
import type { VideoOverlay } from "../scene";
import type { SourceThumbnail } from "../use-source-thumbnails";
import {
  useTimelineViewState,
  useTimelineViewStore,
  type TimelineViewStore,
} from "../use-timeline-view";
import { OverlayLane, type WindowChangePhase } from "./overlay-lane";
import {
  formatScrubTime,
  rulerMinorTicks,
  rulerTicks,
  thumbnailAt,
  thumbnailTiles,
  timeToFraction,
} from "./timeline-geometry";
import {
  TimelinePointerContext,
  TimelineViewContext,
  type TimelinePointer,
} from "./timeline-pointer";
import {
  clampView,
  scaleOf,
  timeAt,
  timeDelta,
  visibleRange,
  wheelZoomFactor,
  xOf,
  type TimelineView,
} from "./timeline-view";
import styles from "./timeline-strip.module.css";

// Past this fraction the hover readout sits LEFT of its line: on the right it would hang
// past the end of the ruler and get clipped at the window edge.
const HOVER_FLIP_FRACTION = 0.9;

// A labelled tick this close to the right END of the content keeps its line but drops its
// label, which would otherwise hang past the end of the ruler. The room is a share of the
// VISIBLE lane (4 %: about 40 px in a 1000 px lane), i.e. a fixed number of pixels measured
// against the content's right edge, so it does not grow with the zoom: as a share of the
// whole timeline it would blank the last 4 s of a 100 s take at 16x. At 1x the lane IS the
// content, so this is exactly the old "last 4 % of the ruler" rule.
const LAST_LABEL_ROOM = 0.04;

/** A lane stacked under the main track (Zooms, Webcam, Privacy, Audio — video-editor v2). */
export interface ExtraLane {
  key: string;
  /** Lane name for the label column. */
  label: string;
  /** Drawn before the name; the name stays the label's accessible text. */
  icon: LucideIcon;
  /** A SINGLE element, not a ReactNode: .timelineBody is a two-column grid and
   *  auto-places one child per cell, so a lane rendering a fragment with two roots
   *  would push every following label and lane one cell along. LaneRow also wraps it
   *  in its own cell div, so neither mistake can reach the grid. */
  node: ReactElement;
}

export const TimelineStrip = memo(function TimelineStrip({
  layout,
  playback,
  thumbnails,
  selectedItemId,
  onSelectItem,
  onTrim,
  slideUrlFor,
  onSlideDuration,
  overlays,
  showOverlays = true,
  selectedOverlayId,
  onSelectOverlay,
  onWindowChange,
  extraLanes = [],
  timelineView,
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
  /** False while Annotations is hidden in the Tracks popover (view state only: the
   *  annotations still draw on the preview and in the export). Defaults to shown. */
  showOverlays?: boolean;
  selectedOverlayId: string | null;
  onSelectOverlay: (id: string | null) => void;
  onWindowChange?: (id: string, start: number, end: number, phase: WindowChangePhase) => void;
  /** Lanes rendered below the main track, each with its label, in order. */
  extraLanes?: ExtraLane[];
  /** The page's zoom and scroll (the transport bar's zoom control drives the same store).
   *  Omitted, the strip keeps its own, at fit. */
  timelineView?: TimelineViewStore;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const cornerRef = useRef<HTMLSpanElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const hoverRef = useRef<HTMLDivElement | null>(null);
  const hoverLabelRef = useRef<HTMLSpanElement | null>(null);
  // True while a pointer is scrubbing the ruler or the track: the view must not turn a
  // page under the pointer that is dragging the playhead.
  const scrubbingRef = useRef(false);
  // True while a trim or slide-duration handle is being dragged. Such a drag rewrites the cut
  // layout on every move, so the timeline's duration (and the pixel scale) changes under the
  // pointer; nothing may scroll the view then (a boolean, not a count: one drag at a time).
  const editDragRef = useRef(false);
  const setEditDrag = useCallback((active: boolean) => {
    editDragRef.current = active;
  }, []);
  // Backstop for the same flag: the handles end their own drag when they go away (see
  // TrackBlock), but a flag that stuck would silently stop every paused seek from being
  // revealed, so it also comes down whenever the selection changes. Nothing starts a handle
  // drag without a selected clip, and no drag survives its selection.
  useEffect(() => {
    editDragRef.current = false;
  }, [selectedItemId]);
  // The scroll position the strip itself last put on the element, so the scroll event it
  // causes is not mistaken for the user panning.
  const appliedScrollRef = useRef(0);
  const duration = layoutDuration(layout);
  // Without the callback the guard `?.` would need an inline arrow, and a new function on every
  // render defeats the memoised OverlayLane.
  const handleWindowChange = useCallback(
    (id: string, start: number, end: number, phase: WindowChangePhase) =>
      onWindowChange?.(id, start, end, phase),
    [onWindowChange],
  );

  const ownStore = useTimelineViewStore(duration);
  const store = timelineView ?? ownStore;
  const viewState = useTimelineViewState(store);
  // `viewState` is a stable snapshot: a new object only when zoom, scroll or lane changed.
  const view = useMemo(() => clampView({ ...viewState, duration }), [viewState, duration]);

  // The lane's place on screen, read live: the strip's left edge plus the (sticky) label
  // column and the gap to the lanes, and its width less those and the room the stylesheet
  // leaves after the lanes for the last handle (--lane-gap, --lane-end). Nothing is
  // cached, so a window resize or a layout shift cannot leave a stale number behind a
  // pointer conversion.
  const measureLane = useCallback((): { laneLeft: number; laneWidth: number } | null => {
    const body = bodyRef.current;
    const corner = cornerRef.current;
    if (!body || !corner) return null;
    const bodyRect = body.getBoundingClientRect();
    const labels = corner.getBoundingClientRect().width;
    const style = getComputedStyle(body);
    const gap = parseFloat(style.getPropertyValue("--lane-gap")) || 0;
    const end = parseFloat(style.getPropertyValue("--lane-end")) || 0;
    return {
      laneLeft: bodyRect.left + labels + gap,
      laneWidth: Math.max(0, bodyRect.width - labels - gap - end),
    };
  }, []);

  // The view as it is right now: the store's zoom, the DOM's scroll (the user's wheel can
  // move it a frame before the store hears about it) and the live lane width.
  const readView = useCallback((): { view: TimelineView; laneLeft: number } | null => {
    const lane = measureLane();
    if (!lane || lane.laneWidth <= 0) return null;
    store.setLaneWidth(lane.laneWidth);
    const live = store.getView();
    const scroll = bodyRef.current?.scrollLeft ?? live.scroll;
    return { view: clampView({ ...live, scroll }), laneLeft: lane.laneLeft };
  }, [store, measureLane]);

  // THE conversion: every lane, the ruler and the track ask this, nothing divides by its
  // own width (see timeline-pointer.tsx).
  const timeAtPointer = useCallback(
    (clientX: number): number | null => {
      const read = readView();
      return read ? timeAt(read.view, clientX, read.laneLeft) : null;
    },
    [readView],
  );
  const pointer = useMemo<TimelinePointer>(() => ({ timeAtPointer }), [timeAtPointer]);

  // A drag that moves an edge by a pointer delta freezes the mapping on pointerdown: a trim
  // changes `duration`, so the live pixel-to-time mapping moves under the pointer.
  const freezeMapping = useCallback(
    (): TimelineView | null => readView()?.view ?? null,
    [readView],
  );

  // Lane width: measured before the first paint, then on every resize.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    // The last width this effect measured. 0 means the strip was hidden: the store ignores a
    // 0 px lane (it keeps the zoom and the scroll), so when the lane comes back at the SAME
    // width nothing in the store changes and the layout effect below does not run, while the
    // browser may have dropped `scrollLeft` while the strip was `display: none`.
    let previousWidth: number | null = null;
    const sync = (): void => {
      const lane = measureLane();
      if (!lane) return;
      store.setLaneWidth(lane.laneWidth);
      if (previousWidth === 0 && lane.laneWidth > 0 && body) {
        // Put the element back where the store says it is, and note it as ours so the scroll
        // event this write causes is not read as the user panning.
        body.scrollLeft = store.getView().scroll;
        appliedScrollRef.current = body.scrollLeft;
      }
      previousWidth = lane.laneWidth;
    };
    sync();
    if (!body || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(body);
    return () => observer.disconnect();
  }, [store, measureLane]);

  // The store decides the scroll (zoom around the pointer, follow, FIT); the element
  // obeys. After the commit, so the content already has its new width.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (Math.abs(body.scrollLeft - view.scroll) > 0.5) body.scrollLeft = view.scroll;
    appliedScrollRef.current = body.scrollLeft;
  }, [view.scroll, view.zoom, view.laneWidth]);

  // A scroll nobody here asked for is the user panning: tell the store, which stops
  // following the playhead until the next play.
  const onScroll = useCallback(() => {
    const body = bodyRef.current;
    if (!body || Math.abs(body.scrollLeft - appliedScrollRef.current) <= 0.5) return;
    appliedScrollRef.current = body.scrollLeft;
    store.scrollTo(body.scrollLeft, "user");
  }, [store]);

  // ⌘/Ctrl + wheel, and a trackpad pinch (Chromium delivers it as a wheel with ctrlKey),
  // zoom around the pointer. A plain wheel is left to the browser: a horizontal swipe pans
  // the scroll container natively. Native listener, not onWheel: React's is passive and
  // cannot stop the page zooming.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const onWheel = (event: WheelEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return;
      event.preventDefault();
      const lane = measureLane();
      store.zoomAtPointer(
        wheelZoomFactor(event.deltaY, event.deltaMode),
        event.clientX,
        lane?.laneLeft ?? 0,
      );
    };
    body.addEventListener("wheel", onWheel, { passive: false });
    return () => body.removeEventListener("wheel", onWheel);
  }, [store, measureLane]);

  // Playing hands the view back to the playhead.
  useEffect(() => {
    if (playback.playing) store.resumeFollow();
  }, [playback.playing, store]);

  // Playhead follows playback at rAF frequency via direct style mutation —
  // re-rendering the strip 60×/s would drop frames during playback.
  const playingRef = useRef(playback.playing);
  playingRef.current = playback.playing;
  useEffect(() => {
    return playback.subscribeTime((time) => {
      const el = playheadRef.current;
      if (el) el.style.left = `${timeToFraction(time, duration) * 100}%`;
      if (playingRef.current && !scrubbingRef.current) store.follow(time);
    });
  }, [playback, duration, store]);

  // Also position on low-frequency updates (paused seeks don't run the rAF loop). The line
  // is a share of the content, so a new duration moves it too.
  useEffect(() => {
    const el = playheadRef.current;
    if (el) el.style.left = `${timeToFraction(playback.timelineTime, duration) * 100}%`;
  }, [playback.timelineTime, duration]);

  // A seek by keyboard or button can land off screen: bring it into view, but never move
  // the view under a pointer that is scrubbing or dragging a handle, or for a playhead that
  // is already visible. Keyed on the TIME alone, deliberately: a trim or a slide-duration
  // drag changes `duration` on every move while the playhead stays on the same time, and
  // an effect that also depended on `duration` would "reveal" that unmoved playhead each
  // frame and carry the view away from the handle under the pointer. Nor on `playing`:
  // pausing must not snap the view back to a playhead the user had panned away from.
  useEffect(() => {
    if (scrubbingRef.current || editDragRef.current) return;
    if (playingRef.current) store.follow(playback.timelineTime);
    else store.reveal(playback.timelineTime);
  }, [playback.timelineTime, store]);

  // The ruler is the dedicated scrub surface. It sits in its own row ABOVE all clip
  // blocks, so it is always reachable no matter how the clips are laid out. Blocks
  // call stopPropagation on their own pointerdown to remain select-only; this ruler
  // row is never blocked by them. Scrubbing does NOT pause — the user can drag the
  // playhead while video plays and it keeps playing from the new position.
  const endScrub = useCallback(() => {
    scrubbingRef.current = false;
  }, []);

  const startScrub = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      scrubbingRef.current = true;
      playback.seek(timeAtPointer(event.clientX) ?? 0);
    },
    [playback, timeAtPointer],
  );

  // The hover preview: a faint line and the time under the pointer, so the ruler shows
  // where a click would seek before anyone clicks. Moved by direct DOM mutation for the
  // same reason as the playhead — a re-render per pointermove would rebuild every lane.
  const showHoverAt = useCallback(
    (time: number) => {
      const el = hoverRef.current;
      const label = hoverLabelRef.current;
      if (!el || !label) return;
      el.style.left = `${timeToFraction(time, duration) * 100}%`;
      el.dataset.visible = "true";
      // Flip by where the line sits in the VISIBLE lane: zoomed, the line can be far from
      // the end of the content and still at the edge of what is on screen.
      const read = readView();
      const share = read
        ? xOf(read.view, time) / read.view.laneWidth
        : timeToFraction(time, duration);
      if (share > HOVER_FLIP_FRACTION) el.dataset.flip = "true";
      else delete el.dataset.flip;
      label.textContent = formatScrubTime(time);
    },
    [duration, readView],
  );

  const hideHover = useCallback(() => {
    if (hoverRef.current) delete hoverRef.current.dataset.visible;
  }, []);

  const onRulerPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const time = timeAtPointer(event.clientX) ?? 0;
      showHoverAt(time);
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      playback.seek(time);
    },
    [playback, timeAtPointer, showHoverAt],
  );

  // The track background also handles scrub for clicks that land on empty track area
  // (between blocks). Consistent with the ruler: no forced pause — scrubbing keeps
  // playback running from the new point.
  const onTrackPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      playback.seek(timeAtPointer(event.clientX) ?? 0);
    },
    [playback, timeAtPointer],
  );

  // What the lane draws is windowed by what is on screen: a ruler or a filmstrip for a
  // 10-minute take at 24x would otherwise be thousands of elements nobody sees.
  const scale = scaleOf(view);
  const shown = scale > 0 ? visibleRange(view) : { start: 0, end: duration };
  const tickWindow = view.zoom > 1 ? shown : undefined;
  const tickStart = tickWindow?.start;
  const tickEnd = tickWindow?.end;

  // The ruler depends on the duration, the zoom and, once zoomed, the window on screen. At fit
  // there is no window, so a re-render of a long recording (a slider dragged elsewhere) reuses
  // the hundreds of tick spans instead of rebuilding them (NIW2-662); zoomed, they follow the
  // scroll, as the windowing above requires. Primitives in the dependencies: `shown` is a new
  // object on every render.
  const rulerMarks = useMemo(() => {
    const visible =
      tickStart === undefined || tickEnd === undefined
        ? undefined
        : { start: tickStart, end: tickEnd };
    return (
      <>
        {rulerMinorTicks(duration, view.zoom, visible).map((time) => (
          <span
            key={time}
            className={styles.minorTick}
            style={{ left: `${timeToFraction(time, duration) * 100}%` }}
          />
        ))}
        {rulerTicks(duration, view.zoom, visible).map((tick) => {
          const fraction = timeToFraction(tick.time, duration);
          // The room as a share of the content: the same pixels, over a wider whole.
          const labelFits = fraction < 1 - LAST_LABEL_ROOM / view.zoom;
          return (
            <span key={tick.time} className={styles.tick} style={{ left: `${fraction * 100}%` }}>
              {labelFits && tick.label}
            </span>
          );
        })}
      </>
    );
  }, [duration, view.zoom, tickStart, tickEnd]);

  return (
    <div className={styles.strip}>
      {/* timelineBody is the ONE horizontal scroll container: a two-column grid, labels
          (sticky, so they stay put) + the lanes, whose column is `--zoom` lanes wide. Every
          lane sits in column 2, so all lanes share one extent and scroll together. The
          playhead lives in its own layer spanning column 2 across every row (see
          .playheadLayer) and scrolls with them. */}
      <TimelinePointerContext.Provider value={pointer}>
        <TimelineViewContext.Provider value={view}>
          <div
            ref={bodyRef}
            data-testid="timeline-scroller"
            data-zoom={view.zoom}
            data-scrolled={view.scroll > 0 ? "true" : "false"}
            className={styles.timelineBody}
            style={{ "--zoom": view.zoom } as CSSProperties}
            onScroll={onScroll}
          >
            <span ref={cornerRef} data-testid="lane-corner" className={styles.laneLabel} />
            <div
              data-testid="ruler"
              className={styles.ruler}
              onPointerDown={startScrub}
              onPointerMove={onRulerPointerMove}
              onPointerUp={endScrub}
              onPointerCancel={endScrub}
              onLostPointerCapture={endScrub}
              onPointerLeave={hideHover}
            >
              {rulerMarks}
            </div>
            {/* Clips lead: the recording is what every other lane edits. */}
            <LaneLabel icon={Film} label={t("laneClips")} />
            <div
              className={styles.track}
              onPointerDown={startScrub}
              onPointerMove={onTrackPointerMove}
              onPointerUp={endScrub}
              onPointerCancel={endScrub}
              onLostPointerCapture={endScrub}
            >
              {layout.map((entry) => (
                <TrackBlock
                  key={entry.itemId}
                  entry={entry}
                  duration={duration}
                  thumbnails={thumbnails}
                  scale={scale}
                  shown={shown}
                  selected={entry.itemId === selectedItemId}
                  onSelect={onSelectItem}
                  freezeMapping={freezeMapping}
                  onDragActive={setEditDrag}
                  onTrim={onTrim}
                  slideUrlFor={slideUrlFor}
                  onSlideDuration={onSlideDuration}
                />
              ))}
            </div>
            {/* Annotations are made with the drawing tools on the preview, never on this lane,
                so an empty lane would only be a blank row: it appears with the first one. */}
            {showOverlays && overlays.length > 0 && (
              <LaneRow icon={PenLine} label={t("laneAnnotations")}>
                <OverlayLane
                  overlays={overlays}
                  duration={duration}
                  selectedOverlayId={selectedOverlayId}
                  onSelectOverlay={onSelectOverlay}
                  onWindowChange={handleWindowChange}
                />
              </LaneRow>
            )}
            {extraLanes.map((lane) => (
              <LaneRow key={lane.key} icon={lane.icon} label={lane.label}>
                {lane.node}
              </LaneRow>
            ))}
            {/* Positioned via direct DOM mutation in the subscribeTime callback (avoid React
                re-renders at 60fps). The layer spans every row of the lanes column. */}
            <div className={styles.playheadLayer}>
              <div ref={hoverRef} className={styles.hoverLine}>
                <span ref={hoverLabelRef} className={styles.hoverTime} />
              </div>
              <div ref={playheadRef} className={styles.playhead} />
            </div>
          </div>
        </TimelineViewContext.Provider>
      </TimelinePointerContext.Provider>
    </div>
  );
});

function LaneLabel({ icon: Icon, label }: { icon: LucideIcon; label: string }): React.JSX.Element {
  return (
    <span className={styles.laneLabel}>
      <Icon size={14} aria-hidden className={styles.laneIcon} />
      {label}
    </span>
  );
}

function LaneRow({
  icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactElement;
}): React.JSX.Element {
  return (
    <>
      <LaneLabel icon={icon} label={label} />
      {/* Exactly one grid cell, whatever the lane renders — the label/lane pairing of
          every row below this one depends on it. */}
      <div className={styles.laneCell}>{children}</div>
    </>
  );
}

type DragHandlers = Pick<
  React.DOMAttributes<HTMLDivElement>,
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onLostPointerCapture"
>;

function TrackBlock({
  entry,
  duration,
  thumbnails,
  scale,
  shown,
  selected,
  onSelect,
  freezeMapping,
  onDragActive,
  onTrim,
  slideUrlFor,
  onSlideDuration,
}: {
  entry: LayoutEntry;
  duration: number;
  thumbnails: SourceThumbnail[];
  /** Pixels per timeline second, and the window of timeline time on screen: the block
   *  draws only the thumbnails in that window. */
  scale: number;
  shown: { start: number; end: number };
  selected: boolean;
  onSelect: (itemId: string) => void;
  /** The pixel-to-time mapping as it is right now, to freeze on pointerdown. */
  freezeMapping: () => TimelineView | null;
  /** True from the pointerdown on a trim or slide handle until its drag ends. */
  onDragActive: (active: boolean) => void;
  onTrim?: (
    itemId: string,
    edge: "start" | "end",
    sourceTime: number,
    phase: "start" | "move" | "end",
  ) => void;
  slideUrlFor?: (assetId: string) => string | null;
  onSlideDuration?: (itemId: string, duration: number, phase: "start" | "move" | "end") => void;
}): React.JSX.Element {
  const left = timeToFraction(entry.timelineStart, duration) * 100;
  const width = timeToFraction(entry.timelineEnd - entry.timelineStart, duration) * 100;
  const isSlide = entry.kind === "slide";
  const slideUrl = isSlide && entry.assetId ? (slideUrlFor?.(entry.assetId) ?? null) : null;
  const tiles =
    entry.kind === "clip"
      ? thumbnailTiles({
          timelineStart: entry.timelineStart,
          timelineEnd: entry.timelineEnd,
          sourceStart: entry.sourceStart,
          sourceEnd: entry.sourceEnd,
          scale,
          visible: shown,
        }).tiles
      : [];

  // A drag freezes its baseline on pointerdown (same idea as overlay-lane's bodyOrigin):
  // `orig` is the dragged value then, x0 the pointer x, `mapping` the view (zoom, scroll,
  // lane) then. Moves are `orig + timeDelta(mapping, x0, clientX)`, never derived from the
  // live entry, so a start trim (which changes entry.sourceStart every frame) cannot
  // feed back. `timeDelta` is the pixel-to-time conversion of every other lane: at 4x a
  // drag moves by a quarter of the 1x amount.
  const trimDrag = useRef<{
    edge: "start" | "end";
    orig: number;
    x0: number;
    mapping: TimelineView | null;
    last: number;
  } | null>(null);
  const dragged = (
    drag: { orig: number; x0: number; mapping: TimelineView | null },
    clientX: number,
  ): number => (drag.mapping ? drag.orig + timeDelta(drag.mapping, drag.x0, clientX) : drag.orig);

  // One handler factory for both edges — pointerdown seeds the drag with the edge's
  // current source time, move reports the live source time, up/cancel/lost capture end
  // it. The page maps these phases to beginInteract/updateLive+trimClip/endInteract.
  const trimHandlers = (edge: "start" | "end"): DragHandlers => {
    // Reports "end" exactly once: pointerup releases capture first, so the
    // lostpointercapture it queues finds the ref already null (zoom-lane.tsx contract).
    const finish = (): void => {
      const drag = trimDrag.current;
      if (!drag) return;
      trimDrag.current = null;
      onDragActive(false);
      onTrim?.(entry.itemId, drag.edge, drag.last, "end");
    };
    return {
      onPointerDown: (event) => {
        // Neither scrub the track nor re-select the block underneath.
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const orig = edge === "start" ? entry.sourceStart : entry.sourceEnd;
        trimDrag.current = {
          edge,
          orig,
          x0: event.clientX,
          mapping: freezeMapping(),
          last: orig,
        };
        onDragActive(true);
        onTrim?.(entry.itemId, edge, orig, "start");
      },
      onPointerMove: (event) => {
        event.stopPropagation();
        const drag = trimDrag.current;
        if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        drag.last = dragged(drag, event.clientX);
        onTrim?.(entry.itemId, edge, drag.last, "move");
      },
      onPointerUp: (event) => {
        event.stopPropagation();
        const drag = trimDrag.current;
        if (!drag) return;
        drag.last = dragged(drag, event.clientX);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        finish();
      },
      onPointerCancel: finish,
      onLostPointerCapture: finish,
    };
  };

  // A slide's right handle sets the hold DURATION: same frozen-baseline contract.
  const slideDrag = useRef<{
    orig: number;
    x0: number;
    mapping: TimelineView | null;
    last: number;
  } | null>(null);

  // The handles exist only while the block is selected, and a captured pointer is not
  // released by their leaving: Esc (the page's clearSelection()), another selection or a
  // deleted clip unmounts the handle mid-drag, the browser then sends `lostpointercapture` to
  // the document instead of the gone element, and neither handler's finish() ever runs. This
  // ends the drag by hand: the strip's drag flag comes down (or a paused seek would never
  // scroll an off-screen playhead into view again) and the page gets its "end" (or the scene
  // stays owned by a drag that no longer exists). The latest callbacks are read from a ref:
  // the cleanup must not re-run, and so end the drag, whenever a parent re-renders.
  const latest = useRef({ itemId: entry.itemId, onDragActive, onTrim, onSlideDuration });
  latest.current = { itemId: entry.itemId, onDragActive, onTrim, onSlideDuration };
  useEffect(() => {
    if (!selected) return;
    return () => {
      const {
        itemId,
        onDragActive: setDragActive,
        onTrim: trim,
        onSlideDuration: slide,
      } = latest.current;
      const trimming = trimDrag.current;
      const sliding = slideDrag.current;
      if (!trimming && !sliding) return;
      trimDrag.current = null;
      slideDrag.current = null;
      setDragActive(false);
      if (trimming) trim?.(itemId, trimming.edge, trimming.last, "end");
      if (sliding) slide?.(itemId, sliding.last, "end");
    };
  }, [selected]);

  const slideDurationHandlers = (): DragHandlers => {
    const finish = (): void => {
      const drag = slideDrag.current;
      if (!drag) return;
      slideDrag.current = null;
      onDragActive(false);
      onSlideDuration?.(entry.itemId, drag.last, "end");
    };
    return {
      onPointerDown: (event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const orig = entry.timelineEnd - entry.timelineStart;
        slideDrag.current = { orig, x0: event.clientX, mapping: freezeMapping(), last: orig };
        onDragActive(true);
        onSlideDuration?.(entry.itemId, orig, "start");
      },
      onPointerMove: (event) => {
        event.stopPropagation();
        const drag = slideDrag.current;
        if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        drag.last = dragged(drag, event.clientX);
        onSlideDuration?.(entry.itemId, drag.last, "move");
      },
      onPointerUp: (event) => {
        event.stopPropagation();
        const drag = slideDrag.current;
        if (!drag) return;
        drag.last = dragged(drag, event.clientX);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        finish();
      },
      onPointerCancel: finish,
      onLostPointerCapture: finish,
    };
  };

  return (
    <>
      <button
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
          onSelect(entry.itemId);
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
          tiles.map((tile) => {
            const thumb = thumbnailAt(thumbnails, tile.sourceTime);
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
