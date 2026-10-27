import type { RecordTimingKind } from "@shared/types/ipc";

/**
 * The renderer half of the `[record-timing]` marks (see `main/recording/record-timing.ts`).
 * Each mark is printed here with the milliseconds since this renderer's own first mark, and
 * forwarded to main, which prints it on the clock of the click that began the start, so the
 * terminal shows the whole timeline in one place.
 */

let origin: number | null = null;

function emit(label: string, kind: RecordTimingKind): void {
  const at = performance.now();
  if (origin === null) return;
  console.info(`[record-timing] renderer +${Math.round(at - origin)}ms ${label}`);
  try {
    window.electronAPI.reportRecordTiming?.(label, kind);
  } catch {
    // A diagnostic: it never changes what the recorder does.
  }
}

/**
 * Open this renderer's timeline. `restartMain`: the step is where the timeline begins for main
 * too (a stop); a start keeps main's clock, which began at the click in main.
 */
export function beginRecordTiming(label: string, restartMain = false): void {
  origin = performance.now();
  emit(label, restartMain ? "begin" : "mark");
}

/** A step of the open timeline; nothing when none is open. */
export function markRecordTiming(label: string): void {
  emit(label, "mark");
}

/** The last step: printed, then the timeline closes on both sides. */
export function endRecordTiming(label: string): void {
  emit(label, "end");
  origin = null;
}
