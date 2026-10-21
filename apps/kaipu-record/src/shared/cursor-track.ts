/**
 * Cursor event track — the sidecar the recorder writes next to a screen recording
 * (`.kaipu/<id>.cursor.json`). Shared by main (writer) and renderer (editor).
 *
 * Time: VIDEO time in integer milliseconds — 0 is the first media sample of the MP4,
 * and recorder pauses are already removed (main rebases every sample at finalize, see
 * main/recording/cursor-clock.ts). Consumers never deal with clocks or pauses.
 *
 * Space: x/y are normalized 0–1 of the captured display's bounds. Values outside
 * [0, 1] are legal — the pointer was on another display.
 *
 * Storage is columnar (`t`, `x`, `y` parallel arrays) to keep the JSON small.
 */

export const CURSOR_TRACK_VERSION = 1;

/** 0 = primary (left), 1 = middle, 2 = secondary (right) — same as DOM MouseEvent.button. */
export type CursorButton = 0 | 1 | 2;

export interface CursorClick {
  t: number;
  x: number;
  y: number;
  button: CursorButton;
}

export interface CursorTrack {
  version: 1;
  /** The captured display, in DIP. `id` is Electron's `Display.id` as a string. */
  display: { id: string; width: number; height: number; scaleFactor: number };
  /**
   * "exact" when t0 came from mediabunny's first-media timestamp; "estimated" when
   * the fallback (renderer clock right after `output.start()`) was used.
   */
  anchor: "exact" | "estimated";
  /** False when no click hook ran — an empty `clicks` then means "unknown", not "none". */
  clicksAvailable: boolean;
  t: number[];
  x: number[];
  y: number[];
  clicks: CursorClick[];
  /**
   * Video time at which sampling stopped because MAX_CURSOR_SAMPLES was reached.
   * Absent on every normal recording. The v2 editor ignores it: it exists so that a
   * very long take whose pointer "freezes" halfway is diagnosable from the sidecar.
   */
  truncatedAtMs?: number;
}

export interface CursorPoint {
  x: number;
  y: number;
}

export function serializeCursorTrack(track: CursorTrack): string {
  return JSON.stringify(track);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNumArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every(isNum);
}

/**
 * Structural validation (no zod — same convention as video-editor/session.ts).
 * Returns null for anything malformed so the editor silently opens without zooms.
 */
export function parseCursorTrack(json: string): CursorTrack | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== CURSOR_TRACK_VERSION) return null;

  const d = r.display as Record<string, unknown> | null | undefined;
  if (typeof d !== "object" || d === null) return null;
  if (typeof d.id !== "string" || !isNum(d.width) || !isNum(d.height) || !isNum(d.scaleFactor))
    return null;
  if (d.width <= 0 || d.height <= 0) return null;

  if (r.anchor !== "exact" && r.anchor !== "estimated") return null;
  if (typeof r.clicksAvailable !== "boolean") return null;
  // Optional: absent unless the sample cap was hit. Present-but-malformed is a reject.
  if (r.truncatedAtMs !== undefined && !isNum(r.truncatedAtMs)) return null;

  if (!isNumArray(r.t) || !isNumArray(r.x) || !isNumArray(r.y)) return null;
  if (r.t.length !== r.x.length || r.t.length !== r.y.length) return null;
  for (let i = 1; i < r.t.length; i++) {
    if (r.t[i] < r.t[i - 1]) return null; // must be sorted for binary search
  }

  if (!Array.isArray(r.clicks)) return null;
  const clicks: CursorClick[] = [];
  for (const c of r.clicks as unknown[]) {
    if (typeof c !== "object" || c === null) return null;
    const cc = c as Record<string, unknown>;
    if (!isNum(cc.t) || !isNum(cc.x) || !isNum(cc.y)) return null;
    if (cc.button !== 0 && cc.button !== 1 && cc.button !== 2) return null;
    clicks.push({ t: cc.t, x: cc.x, y: cc.y, button: cc.button });
  }
  clicks.sort((a, b) => a.t - b.t);

  const track: CursorTrack = {
    version: 1,
    display: { id: d.id, width: d.width, height: d.height, scaleFactor: d.scaleFactor },
    anchor: r.anchor,
    clicksAvailable: r.clicksAvailable,
    t: r.t,
    x: r.x,
    y: r.y,
    clicks,
  };
  if (isNum(r.truncatedAtMs)) track.truncatedAtMs = r.truncatedAtMs;
  return track;
}

/** Index of the last sample with `t[i] <= tMs`, or -1 when `tMs` is before the first. */
export function lastIndexAtOrBefore(t: number[], tMs: number): number {
  let lo = 0;
  let hi = t.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= tMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Pointer position at video time `tMs` (linear interpolation between the two
 * surrounding samples; clamped to the first/last sample outside the track).
 * Returns null only for an empty track.
 */
export function sampleCursor(track: CursorTrack, tMs: number): CursorPoint | null {
  const n = track.t.length;
  if (n === 0) return null;
  const i = lastIndexAtOrBefore(track.t, tMs);
  if (i < 0) return { x: track.x[0], y: track.y[0] };
  if (i >= n - 1) return { x: track.x[n - 1], y: track.y[n - 1] };
  const t0 = track.t[i];
  const t1 = track.t[i + 1];
  const k = t1 === t0 ? 0 : (tMs - t0) / (t1 - t0);
  return {
    x: track.x[i] + (track.x[i + 1] - track.x[i]) * k,
    y: track.y[i] + (track.y[i + 1] - track.y[i]) * k,
  };
}

/** True when a normalized point lies on the captured display. */
export function isOnDisplay(p: CursorPoint): boolean {
  return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}
