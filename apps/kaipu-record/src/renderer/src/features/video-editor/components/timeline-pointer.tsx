/**
 * How a lane turns a pointer position into timeline time (NIW2-667). The strip owns the
 * zoom, the scroll and the lane's position on screen, so it provides the one conversion;
 * every lane (ruler, track, annotations, zooms, webcam, privacy, audio) asks it instead
 * of dividing by its own width. A lane that did its own division would be right at 1x and
 * wrong the moment the timeline is zoomed: a drag at 4x moving by the 1x amount.
 *
 * Two contexts, because they change at different rates: the conversion is one stable
 * object, while the view (what the lane may need to window its drawing by) changes on
 * every scroll and only the webcam filmstrip reads it.
 */
import { createContext, useCallback, useContext, type RefObject } from "react";
import { fitView, timeAt, type TimelineView } from "./timeline-view";

export interface TimelinePointer {
  /**
   * The timeline time under a screen x, clamped to the timeline, or null while the lane
   * has no width yet. Goes through {@link timeAt} with the strip's live zoom, scroll and
   * lane position.
   */
  timeAtPointer(clientX: number): number | null;
}

export const TimelinePointerContext = createContext<TimelinePointer | null>(null);

/** The view the strip last rendered with, for lanes that window what they draw by it. */
export const TimelineViewContext = createContext<TimelineView | null>(null);

/**
 * `clientX → timeline time` for a lane. Under a strip it is the strip's conversion; a
 * lane rendered alone (a test, a future host) falls back to measuring ITS OWN box, which
 * is still exact because the lane is as wide as the content and its left edge already
 * includes the scroll.
 */
export function useTimelinePointer(
  laneRef: RefObject<HTMLElement | null>,
  duration: number,
): (clientX: number) => number | null {
  const pointer = useContext(TimelinePointerContext);
  return useCallback(
    (clientX: number): number | null => {
      if (pointer) return pointer.timeAtPointer(clientX);
      const rect = laneRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return null;
      return timeAt(fitView(rect.width, duration), clientX, rect.left);
    },
    [pointer, laneRef, duration],
  );
}

/** The strip's current view, or null for a lane rendered outside a strip. */
export function useTimelineViewContext(): TimelineView | null {
  return useContext(TimelineViewContext);
}
