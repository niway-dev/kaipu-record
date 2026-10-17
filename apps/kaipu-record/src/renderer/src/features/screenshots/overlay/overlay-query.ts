import {
  isCaptureMode,
  type CaptureMode,
  type CaptureRect,
} from "@shared/types/screenshot-capture";

/**
 * Everything a capture overlay window needs to draw, read from its URL query (built by
 * `overlayQuery` in `main/screenshots/capture-overlay-windows.ts`):
 *
 *   ?window=capture-overlay&display=<id>&ui=<mode>&index=<1-based>&count=<n>
 *    &bounds=x,y,w,h&work=x,y,w,h&ids=<id1>,<id2>,…[&frame=<id>]
 *
 * `bounds` and `work` are the display's bounds and work area in DIP, absolute in screen
 * coordinates (x can be negative). The window covers `bounds`, so window-local (0,0) is
 * `bounds.x, bounds.y`. `ids` lists every picked display in order.
 */
export interface OverlayQuery {
  displayId: number;
  ui: CaptureMode;
  /** 1-based position of this display among the picked ones: its chooser number. */
  index: number;
  count: number;
  bounds: CaptureRect;
  work: CaptureRect;
  /** Every picked display's id in order: digit N on any overlay picks `ids[N - 1]`. */
  ids: number[];
  /** Frame only: the display that starts with the frame; null when absent or malformed. */
  frame: number | null;
}

function parseIds(value: string | null): number[] | null {
  if (!value) return null;
  const ids = value.split(",").map((part) => parseInteger(part));
  return ids.every((id): id is number => id !== null) ? ids : null;
}

function parseRect(value: string | null): CaptureRect | null {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [x, y, width, height] = parts as [number, number, number, number];
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function parseInteger(value: string | null): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/** Parse the overlay query, or null when any part is missing or malformed. */
export function parseOverlayQuery(search: string): OverlayQuery | null {
  const params = new URLSearchParams(search);
  const displayId = parseInteger(params.get("display"));
  const ui = params.get("ui");
  const index = parseInteger(params.get("index"));
  const count = parseInteger(params.get("count"));
  const bounds = parseRect(params.get("bounds"));
  const work = parseRect(params.get("work"));
  const ids = parseIds(params.get("ids"));
  if (displayId === null || !isCaptureMode(ui) || index === null || count === null) return null;
  if (!bounds || !work || index < 1 || count < index) return null;
  if (!ids || ids.length !== count || ids[index - 1] !== displayId) return null;
  return {
    displayId,
    ui,
    index,
    count,
    bounds,
    work,
    ids,
    frame: parseInteger(params.get("frame")),
  };
}

/** The work area in the window's own (display-relative) coordinates. */
export function workAreaInWindow(query: Pick<OverlayQuery, "bounds" | "work">): CaptureRect {
  return {
    x: query.work.x - query.bounds.x,
    y: query.work.y - query.bounds.y,
    width: query.work.width,
    height: query.work.height,
  };
}
