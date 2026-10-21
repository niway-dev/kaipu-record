/**
 * Growable, de-duplicating store for raw cursor samples (main clock, normalized
 * position). NOT a ring buffer: a ring buffer silently drops the start of any
 * recording longer than its capacity, and the detector needs the whole take.
 *
 * De-duplication: an idle pointer produces the same position 125 times a second.
 * Identical samples are skipped, BUT the last skipped one is written right before
 * the next different sample. Without that, interpolation would glide slowly from
 * the old position (seconds ago) to the new one instead of jumping when it moved.
 */

/** 1e-4 of the display ≈ 0.26 px on a 2560 px panel — below visible precision. */
const POSITION_DECIMALS = 1e4;

/** ~2.2 h at 125 Hz of constant motion. Past this, sampling stops (the file stays valid). */
export const MAX_CURSOR_SAMPLES = 1_000_000;

export class CursorSampleBuffer {
  readonly t: number[] = [];
  readonly x: number[] = [];
  readonly y: number[] = [];
  private pending: { t: number; x: number; y: number } | null = null;
  /**
   * Main-clock ms of the FIRST sample dropped because the cap was hit; null when the
   * cap was never reached. Persisted (rebased to video time) as `CursorTrack.truncatedAtMs`.
   */
  truncatedAtMs: number | null = null;

  push(t: number, x: number, y: number): void {
    if (this.t.length >= MAX_CURSOR_SAMPLES) {
      this.truncatedAtMs ??= t;
      return;
    }
    const rx = Math.round(x * POSITION_DECIMALS) / POSITION_DECIMALS;
    const ry = Math.round(y * POSITION_DECIMALS) / POSITION_DECIMALS;
    const n = this.t.length;
    if (n > 0 && this.x[n - 1] === rx && this.y[n - 1] === ry) {
      this.pending = { t, x: rx, y: ry };
      return;
    }
    if (this.pending) {
      this.append(this.pending.t, this.pending.x, this.pending.y);
      this.pending = null;
    }
    this.append(t, rx, ry);
  }

  /** Write the trailing duplicate (if any) so the last known position is timed correctly. */
  flush(): void {
    if (this.pending) {
      this.append(this.pending.t, this.pending.x, this.pending.y);
      this.pending = null;
    }
  }

  get length(): number {
    return this.t.length;
  }

  private append(t: number, x: number, y: number): void {
    this.t.push(t);
    this.x.push(x);
    this.y.push(y);
  }
}
