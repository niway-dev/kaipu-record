/**
 * Main-process cursor sampler for ONE recording (one writer session id). Pure-ish:
 * Electron is injected (`CursorTrackerDeps`) so the whole lifecycle is unit-tested.
 *
 * Lifecycle (driven by recording-hub.ts IPC handlers):
 *   start()            recorder called cursorTrackStart — sampling begins at once, so
 *                      the samples before the first frame exist and are trimmed later
 *   setAnchor(t0)      recorder measured video time 0 (main clock)
 *   pause()/resume()   recorder paused/resumed the encoder (main clock)
 *   addClick(button)   click hook fired (doc 03); position = poller's current point
 *   stop() + build()   at recordingFinalize — returns the persisted CursorTrack
 */
import type { CursorButton, CursorTrack } from "@shared/cursor-track";
import { buildCursorTrack } from "./build-cursor-track";
import { type ClockAnchor, closeOpenPause } from "./cursor-clock";
import { CursorSampleBuffer } from "./cursor-sample-buffer";

/**
 * 8 ms = 125 Hz. `screen.getCursorScreenPoint()` is a synchronous call on the same main
 * thread that serialises the recording's chunk writes, so this rate is a budget, not a
 * free choice — Task 9 measures it against a 5-minute high-quality take and says when to
 * back off to 16 ms (60 Hz), which is still twice the frame rate.
 */
export const CURSOR_SAMPLE_INTERVAL_MS = 8;

export interface CapturedDisplay {
  /** Electron `Display.id` as a string (desktopCapturer's `display_id`). */
  id: string;
  /** DIP, global desktop space — `Display.bounds` (NOT workArea: capture includes the menu bar). */
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

export interface CursorTrackerDeps {
  /** Main-process `performance.now()`. */
  now(): number;
  /** `screen.getCursorScreenPoint()` — DIP, global desktop space. */
  cursorPoint(): { x: number; y: number };
  /** Run `fn` every `ms`; returns a function that stops it. */
  every(ms: number, fn: () => void): () => void;
}

export class CursorTracker {
  private readonly samples = new CursorSampleBuffer();
  private readonly clicks: { t: number; x: number; y: number; button: CursorButton }[] = [];
  private anchor: ClockAnchor | null = null;
  private anchorQuality: "exact" | "estimated" = "estimated";
  private stopTimer: (() => void) | null = null;

  constructor(
    readonly display: CapturedDisplay,
    private readonly deps: CursorTrackerDeps,
  ) {}

  start(): void {
    if (this.stopTimer) return;
    this.sample();
    this.stopTimer = this.deps.every(CURSOR_SAMPLE_INTERVAL_MS, () => this.sample());
  }

  setAnchor(t0MainMs: number, quality: "exact" | "estimated"): void {
    // Pauses recorded before the anchor (impossible in practice) are kept as-is.
    this.anchor = { t0: t0MainMs, pauses: this.anchor?.pauses ?? [] };
    this.anchorQuality = quality;
  }

  pause(atMainMs: number): void {
    const pauses = this.anchor?.pauses ?? [];
    if (pauses.some((p) => p.end === null)) return; // already paused
    this.anchor = {
      t0: this.anchor?.t0 ?? Number.NaN,
      pauses: [...pauses, { start: atMainMs, end: null }],
    };
  }

  resume(atMainMs: number): void {
    if (!this.anchor) return;
    this.anchor = {
      t0: this.anchor.t0,
      pauses: this.anchor.pauses.map((p) =>
        p.end === null ? { start: p.start, end: atMainMs } : p,
      ),
    };
  }

  addClick(button: CursorButton): void {
    if (!this.stopTimer) return;
    const p = this.normalized(this.deps.cursorPoint());
    this.clicks.push({ t: this.deps.now(), x: p.x, y: p.y, button });
  }

  stop(): void {
    this.stopTimer?.();
    this.stopTimer = null;
    this.samples.flush();
  }

  get truncatedAtMs(): number | null {
    return this.samples.truncatedAtMs;
  }

  /**
   * The persisted track, or null when the recorder never sent an anchor.
   * `maxMs` is the recording's duration in ms: this method runs at finalize, well after
   * the last frame, so everything sampled in between has to be cut.
   */
  build(clicksAvailable: boolean, maxMs?: number): CursorTrack | null {
    if (!this.anchor || !Number.isFinite(this.anchor.t0)) return null;
    const anchor = closeOpenPause(this.anchor, this.deps.now());
    return buildCursorTrack({
      raw: { t: this.samples.t, x: this.samples.x, y: this.samples.y, clicks: this.clicks },
      anchor,
      anchorQuality: this.anchorQuality,
      clicksAvailable,
      maxMs,
      truncatedAtMainMs: this.samples.truncatedAtMs,
      display: {
        id: this.display.id,
        width: this.display.bounds.width,
        height: this.display.bounds.height,
        scaleFactor: this.display.scaleFactor,
      },
    });
  }

  private sample(): void {
    const p = this.normalized(this.deps.cursorPoint());
    this.samples.push(this.deps.now(), p.x, p.y);
  }

  private normalized(p: { x: number; y: number }): { x: number; y: number } {
    const b = this.display.bounds;
    return { x: (p.x - b.x) / b.width, y: (p.y - b.y) / b.height };
  }
}

/** All live trackers, keyed by the recorder's writer session id. */
export class CursorTrackRegistry {
  private readonly trackers = new Map<string, CursorTracker>();

  constructor(private readonly deps: CursorTrackerDeps) {}

  start(sessionId: string, display: CapturedDisplay): CursorTracker {
    this.discard(sessionId);
    const tracker = new CursorTracker(display, this.deps);
    this.trackers.set(sessionId, tracker);
    tracker.start();
    return tracker;
  }

  get(sessionId: string): CursorTracker | undefined {
    return this.trackers.get(sessionId);
  }

  /** True while any recording is sampling — the click hook runs only then (doc 03). */
  get active(): boolean {
    return this.trackers.size > 0;
  }

  /** Every live tracker — the click hook fans a click out to all of them. */
  all(): CursorTracker[] {
    return [...this.trackers.values()];
  }

  /**
   * Stop and remove; returns the built track (null when never anchored or unknown id).
   * `maxMs` = the finished recording's duration in ms, so the tail sampled while the
   * file was being finalized is cut.
   */
  finish(sessionId: string, clicksAvailable: boolean, maxMs?: number): CursorTrack | null {
    const tracker = this.trackers.get(sessionId);
    if (!tracker) return null;
    tracker.stop();
    this.trackers.delete(sessionId);
    return tracker.build(clicksAvailable, maxMs);
  }

  discard(sessionId: string): void {
    this.trackers.get(sessionId)?.stop();
    this.trackers.delete(sessionId);
  }

  discardAll(): void {
    for (const id of [...this.trackers.keys()]) this.discard(id);
  }
}
