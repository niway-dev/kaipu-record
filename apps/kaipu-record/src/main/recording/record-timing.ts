import type { RecordTimingKind } from "@shared/types/ipc";

/**
 * `[record-timing]` marks: one console line per step of a recording start or stop, with the
 * milliseconds since the click that began it, so a slow start can be read off a terminal
 * instead of guessed. Main owns the clock; the main renderer forwards its own marks
 * (`recording:timing`) and they are printed here on the same clock, so one start reads as one
 * timeline. Quiet outside a timeline: a mark with no `begin` before it prints nothing.
 */

let origin: number | null = null;

const now = (): number => performance.now();

function print(label: string, at: number, start: number): void {
  console.info(`[record-timing] +${Math.round(at - start)}ms ${label}`);
}

/** Start a timeline (the Start or the Stop click) and print its first mark. */
export function beginRecordTiming(label: string): void {
  origin = now();
  print(label, origin, origin);
}

/** A step of the current timeline; nothing when none is open. */
export function markRecordTiming(label: string): void {
  if (origin !== null) print(label, now(), origin);
}

/** The last step: printed, then the timeline closes so later marks stay quiet. */
export function endRecordTiming(label: string): void {
  markRecordTiming(label);
  origin = null;
}

/** A mark forwarded by the main renderer. Its label crosses a process boundary: kept short. */
export function receiveRecordTiming(label: unknown, kind: unknown): void {
  if (typeof label !== "string" || label.length === 0) return;
  const text = `renderer: ${label.slice(0, 80)}`;
  const parsed: RecordTimingKind = kind === "begin" || kind === "end" ? kind : "mark";
  if (parsed === "begin") beginRecordTiming(text);
  else if (parsed === "end") endRecordTiming(text);
  else markRecordTiming(text);
}
