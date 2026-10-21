/**
 * Pure inspector for a `CursorTrack` — turns the manual "does this sidecar look
 * right" review into a structured report so the expectations of the data live in
 * the repo (tests) instead of in someone's head. Used by the fixture test and by
 * `scripts/cursor-track-check.ts`.
 */
import type { CursorTrack } from "./cursor-track";

export interface CursorTrackMedia {
  durationMs?: number;
  width?: number;
  height?: number;
}

export type FindingLevel = "ok" | "warn" | "error";

export interface CursorTrackFinding {
  level: FindingLevel;
  code: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface CursorTrackReport {
  samples: number;
  clicks: number;
  firstMs: number | null;
  lastMs: number | null;
  bytes: number;
  findings: CursorTrackFinding[];
  /** True when no finding is level "error". */
  ok: boolean;
}

/** Gaps between consecutive samples longer than this are worth reporting. */
const GAP_THRESHOLD_MS = 1500;
/** Ignored when computing the median sampling interval — a real gap, not jitter. */
const RATE_GAP_IGNORE_MS = 100;
/** 50 Hz — below this the poller is running slower than the plan's target rate. */
const RATE_WARN_MS = 20;
/** Slack for `tail-coverage`: covers the last frame's own duration and clock jitter. */
const TAIL_SLACK_MS = 250;
/** Samples past the end of the media by more than this are a real bug, not jitter. */
const TAIL_OVERRUN_MS = 50;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function inspectCursorTrack(
  track: CursorTrack,
  media?: CursorTrackMedia,
): CursorTrackReport {
  const findings: CursorTrackFinding[] = [];
  const { t, x, y } = track;
  const samples = t.length;
  const firstMs = samples > 0 ? t[0] : null;
  const lastMs = samples > 0 ? t[samples - 1] : null;
  const bytes = JSON.stringify(track).length;

  if (track.anchor !== "exact") {
    findings.push({
      level: "warn",
      code: "anchor-estimated",
      message: "The track's t0 is estimated (renderer clock fallback), not exact.",
    });
  }

  if (x.length !== t.length || y.length !== t.length) {
    findings.push({
      level: "error",
      code: "arrays-mismatched",
      message: "t/x/y column lengths differ.",
      data: { t: t.length, x: x.length, y: y.length },
    });
  }

  let sorted = true;
  for (let i = 1; i < t.length; i++) {
    if (t[i] < t[i - 1]) {
      sorted = false;
      break;
    }
  }
  if (!sorted) {
    findings.push({
      level: "error",
      code: "t-unsorted",
      message: "t is not strictly increasing.",
    });
  }

  if (samples === 0) {
    findings.push({
      level: "warn",
      code: "empty",
      message: "The track has no samples.",
    });
  }

  let outOfDisplay = 0;
  for (let i = 0; i < samples; i++) {
    if (x[i] < 0 || x[i] > 1 || y[i] < 0 || y[i] > 1) outOfDisplay++;
  }
  if (outOfDisplay > 0) {
    findings.push({
      level: "warn",
      code: "out-of-display",
      message: `${outOfDisplay} sample(s) fall outside [0, 1] — legal (pointer on another display), but worth reporting.`,
      data: { count: outOfDisplay },
    });
  }

  if (track.truncatedAtMs !== undefined) {
    findings.push({
      level: "warn",
      code: "truncated",
      message: "Sampling stopped early because MAX_CURSOR_SAMPLES was reached.",
      data: { atMs: track.truncatedAtMs },
    });
  }

  for (let i = 1; i < samples; i++) {
    const gapMs = t[i] - t[i - 1];
    if (gapMs > GAP_THRESHOLD_MS) {
      const moved = x[i] !== x[i - 1] || y[i] !== y[i - 1];
      findings.push({
        level: moved ? "warn" : "ok",
        code: "gap",
        message: moved
          ? "A gap between samples with the pointer moving on both sides — samples are missing (a pause not removed, or the poller stalled)."
          : "A gap between samples with an idle pointer — expected: the de-dup writes the trailing duplicate before the next move.",
        data: { atMs: t[i - 1], gapMs, moved },
      });
    }
  }

  // `late-start` is informational, not a warning: the sample buffer collapses every
  // identical-position sample before the pointer's first move into one entry (see
  // CursorSampleBuffer). A track that starts late with two *different* first
  // positions is not evidence of dropped samples — it just means the pointer was
  // idle before its first recorded move, and the pre-move duplicate isn't kept.
  if (samples >= 2 && firstMs !== null && firstMs > 1000) {
    const samePosition = x[0] === x[1] && y[0] === y[1];
    if (!samePosition) {
      findings.push({
        level: "ok",
        code: "late-start",
        message: `No samples before ${firstMs} ms; the pointer had not moved yet.`,
        data: { firstMs },
      });
    }
  }

  if (media?.durationMs !== undefined) {
    const durationMs = media.durationMs;
    if (lastMs === null) {
      // Nothing to compare — `empty` already covers this case.
    } else if (lastMs > durationMs + TAIL_OVERRUN_MS) {
      findings.push({
        level: "error",
        code: "tail-coverage",
        message: "Samples exist past the end of the media — the tail cut failed.",
        data: { lastMs, durationMs },
      });
    } else if (lastMs < durationMs - TAIL_SLACK_MS) {
      findings.push({
        level: "warn",
        code: "tail-coverage",
        message: "The track ends noticeably before the media ends.",
        data: { lastMs, durationMs, missingMs: durationMs - lastMs },
      });
    } else {
      findings.push({
        level: "ok",
        code: "tail-coverage",
        message: "The track's last sample covers the end of the media.",
        data: { lastMs, durationMs },
      });
    }
  }

  if (track.clicksAvailable === false) {
    findings.push({
      level: "ok",
      code: "clicks-unavailable",
      message:
        "Clicks require the Accessibility-gated hook; an empty `clicks` here means unknown, not none.",
    });
  }

  const intervals: number[] = [];
  for (let i = 1; i < samples; i++) {
    const gapMs = t[i] - t[i - 1];
    if (gapMs <= RATE_GAP_IGNORE_MS) intervals.push(gapMs);
  }
  if (intervals.length > 0) {
    const medianMs = median(intervals);
    findings.push({
      level: medianMs > RATE_WARN_MS ? "warn" : "ok",
      code: "rate",
      message:
        medianMs > RATE_WARN_MS
          ? `Median sampling interval is ${medianMs} ms — the poller is running slower than 50 Hz.`
          : `Median sampling interval is ${medianMs} ms.`,
      data: { medianMs },
    });
  }

  return {
    samples,
    clicks: track.clicks.length,
    firstMs,
    lastMs,
    bytes,
    findings,
    ok: !findings.some((f) => f.level === "error"),
  };
}
