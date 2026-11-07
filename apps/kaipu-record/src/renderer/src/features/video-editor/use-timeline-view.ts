/**
 * The timeline's zoom and scroll, kept OUTSIDE React state on purpose (NIW2-667).
 *
 * A scroll event fires every frame while the user pans, and the playhead can ask the view
 * to follow it every frame while playing. Holding those in the page's `useState` would
 * re-render the whole editor at that rate; here the page only creates the store, and each
 * consumer subscribes to the slice it draws: the strip to the whole state, the zoom control
 * to the zoom factor alone (a scroll leaves it untouched).
 *
 * The store holds `{ zoom, scroll, laneWidth }`. The duration is the cut layout's, so it
 * is pushed in (`setDuration`) rather than owned: when a clip is deleted at 4x the state
 * is re-clamped against the new duration in the same call, so no consumer ever sees a
 * scroll past the end. The pure maths is `components/timeline-view.ts`; this file only
 * decides WHEN to apply it, and whether the user has taken the view out of the
 * playhead's hands.
 */
import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import {
  ZOOM_STEP,
  clampView,
  followPlayhead,
  keepLeftEdge,
  maxZoom,
  revealTime,
  zoomAt,
  type TimelineView,
} from "./components/timeline-view";

export interface TimelineViewState {
  zoom: number;
  scroll: number;
  laneWidth: number;
}

export interface TimelineViewStore {
  /** A stable snapshot: the same object until the zoom, scroll or lane width changes. */
  getState(): TimelineViewState;
  /** The state against the live duration, clamped — what event handlers should read. */
  getView(): TimelineView;
  /** The deepest zoom this lane and duration allow (1 when it cannot zoom at all). */
  getMaxZoom(): number;
  subscribe(listener: () => void): () => void;
  setDuration(duration: number): void;
  setLaneWidth(px: number): void;
  /** FIT: 1x, scroll 0. */
  fit(): void;
  /** `+` / `−`: one {@link ZOOM_STEP} around the centre of the visible window. A zoom never
   *  stops the view following the playhead (only a pan does), here and in the two below. */
  zoomStep(direction: 1 | -1): void;
  /** The slider: an absolute zoom, around the centre. */
  zoomTo(zoom: number): void;
  /** ⌘/Ctrl + wheel and pinch: around the pointer. */
  zoomAtPointer(factor: number, clientX: number, laneLeft: number): void;
  /**
   * Set the scroll. `"user"` is a pan by hand (the scrollbar, a trackpad swipe) and takes
   * the view out of the playhead's hands until the next play; `"follow"` is a scroll that
   * is not a pan: the view moves and keeps following. Production never sends it (the strip
   * only calls `scrollTo(body.scrollLeft, "user")`, and drops the scroll event its own
   * `scrollLeft` write causes by comparing with `appliedScrollRef`); it exists for callers
   * that need to place the view without taking it from the playhead, as the tests do.
   */
  scrollTo(px: number, by: "user" | "follow"): void;
  /** While PLAYING: turn the page when the playhead passes 80% of the lane. */
  follow(t: number): void;
  /** While paused: scroll only if `t` is off screen (a seek by keyboard or button). */
  reveal(t: number): void;
  /** Play was pressed: the playhead leads again. */
  resumeFollow(): void;
}

export function createTimelineViewStore(): TimelineViewStore {
  let state: TimelineViewState = { zoom: 1, scroll: 0, laneWidth: 0 };
  let duration = 0;
  // False once the user PANS by hand (scrollbar, swipe, drag): playback then leaves the view
  // alone until the next play. A zoom does not count: it keeps the anchor the user chose and
  // the next playback tick turns the page if the playhead ended up outside the lane.
  let following = true;
  const listeners = new Set<() => void>();

  const view = (): TimelineView => clampView({ ...state, duration });

  const notify = (): void => {
    // A copy: a listener may unsubscribe while the others are being told.
    for (const listener of Array.from(listeners)) listener();
  };

  const commit = (next: TimelineView): boolean => {
    if (
      next.zoom === state.zoom &&
      next.scroll === state.scroll &&
      next.laneWidth === state.laneWidth
    ) {
      return false;
    }
    state = { zoom: next.zoom, scroll: next.scroll, laneWidth: next.laneWidth };
    notify();
    return true;
  };

  const limit = (): number => maxZoom(state.laneWidth, duration);

  const centred = (factor: number): void => {
    const current = view();
    commit(zoomAt(current, factor, current.laneWidth / 2, 0));
  };

  return {
    getState: () => state,
    getView: view,
    getMaxZoom: limit,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setDuration(next) {
      const before = limit();
      const from = view();
      duration = next;
      // The scroll is in pixels and the scale follows the duration: keep the TIME at the
      // left edge, so a cut or a stretched slide does not move the window the user is
      // looking at (a trim drag changes the duration on every move).
      // A cut can lower the deepest zoom without touching the state (it was far from it):
      // the zoom control still has to redraw its slider.
      if (!commit(keepLeftEdge(from, { ...from, duration: next })) && limit() !== before) {
        notify();
      }
    },
    setLaneWidth(px) {
      // A lane that measures 0 px is not a lane that shrank to nothing: the element is hidden
      // (a collapsed panel, a background tab) or a ResizeObserver fired before layout. Taking
      // it at its word would clamp the zoom to 1 (a 0 px lane cannot zoom) and the scroll to 0,
      // and the zoom the user chose would be gone when the lane comes back. So the last width,
      // zoom and scroll stay as they were. `!(px > 0)` also turns away a negative or NaN.
      if (!(px > 0)) return;
      // Same reason as setDuration: a resize changes the scale, so the window is kept by its
      // left-edge time.
      const from = view();
      commit(keepLeftEdge(from, { ...from, laneWidth: px }));
    },
    fit() {
      commit({ ...view(), zoom: 1, scroll: 0 });
    },
    zoomStep(direction) {
      centred(direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    },
    zoomTo(zoom) {
      centred(zoom / view().zoom);
    },
    zoomAtPointer(factor, clientX, laneLeft) {
      commit(zoomAt(view(), factor, clientX, laneLeft));
    },
    scrollTo(px, by) {
      if (by === "user") following = false;
      commit(clampView({ ...view(), scroll: px }));
    },
    follow(t) {
      if (!following) return;
      commit(followPlayhead(view(), t));
    },
    reveal(t) {
      commit(revealTime(view(), t));
    },
    resumeFollow() {
      following = true;
    },
  };
}

/** One store per editor page, kept in step with the cut layout's duration. */
export function useTimelineViewStore(duration: number): TimelineViewStore {
  const [store] = useState(createTimelineViewStore);
  useLayoutEffect(() => {
    store.setDuration(duration);
  }, [store, duration]);
  return store;
}

/** The whole state: re-renders on every scroll. For the strip, which draws what is in view. */
export function useTimelineViewState(store: TimelineViewStore): TimelineViewState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** The zoom factor only: re-renders on a zoom, never on a scroll. For the transport bar. */
export function useTimelineZoom(store: TimelineViewStore): number {
  const zoom = (): number => store.getState().zoom;
  return useSyncExternalStore(store.subscribe, zoom, zoom);
}

/** The deepest zoom allowed: re-renders when a cut or a resize moves it, not on a scroll. */
export function useTimelineMaxZoom(store: TimelineViewStore): number {
  const limit = (): number => store.getMaxZoom();
  return useSyncExternalStore(store.subscribe, limit, limit);
}
