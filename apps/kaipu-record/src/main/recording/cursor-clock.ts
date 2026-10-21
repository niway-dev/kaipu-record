/**
 * Maps MAIN-process clock readings (`performance.now()` in main, ms) onto the
 * recording's VIDEO time (ms since the MP4's first media sample, pauses removed).
 *
 * Why this exists: the cursor poller runs in main, the encoder runs in the recorder
 * renderer. mediabunny stamps the file with `performance.now()` of the RENDERER and
 * drops paused time (MediaStreamVideoTrackSource subtracts every frame it discards
 * while paused). So a main-clock sample maps to video time as
 *
 *     video = main − t0 − (sum of pause intervals that ended before `main`)
 *
 * where `t0` and every pause edge have already been converted into the main clock by
 * the renderer (it measured the renderer→main offset with `measureClockOffset`).
 * Samples inside a pause (or before t0) have no video frame and map to null.
 */

export interface PauseInterval {
  /** Main-clock ms when `engine.pause()` ran. */
  start: number;
  /** Main-clock ms when `engine.resume()` ran; null while still paused. */
  end: number | null;
}

export interface ClockAnchor {
  /** Main-clock ms of the MP4's first media sample (video time 0). */
  t0: number;
  /** Chronological, non-overlapping. */
  pauses: PauseInterval[];
}

export function toVideoTimeMs(mainMs: number, anchor: ClockAnchor): number | null {
  if (mainMs < anchor.t0) return null;
  let paused = 0;
  for (const p of anchor.pauses) {
    if (mainMs < p.start) break;
    if (p.end === null || mainMs < p.end) return null; // inside a pause: not in the file
    paused += p.end - p.start;
  }
  return mainMs - anchor.t0 - paused;
}

/** Close a still-open pause (the user stopped while paused). Returns a new anchor. */
export function closeOpenPause(anchor: ClockAnchor, atMainMs: number): ClockAnchor {
  return {
    t0: anchor.t0,
    pauses: anchor.pauses.map((p) => (p.end === null ? { start: p.start, end: atMainMs } : p)),
  };
}
