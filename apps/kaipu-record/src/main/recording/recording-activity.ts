import type { RecordingActivity, RecordingTick } from "@shared/types/ipc";

/**
 * Pure recording-activity state — the "is a recording happening" model that the
 * hub broadcasts to every window. No electron/DOM imports: the hub keeps the
 * side effects (IPC broadcast, window show/hide), this owns the transitions.
 */

export const IDLE_ACTIVITY: RecordingActivity = {
  active: false,
  status: "recording",
  elapsedSeconds: 0,
};

/** Activity when a recording starts. */
export function startedActivity(): RecordingActivity {
  return { active: true, status: "recording", elapsedSeconds: 0 };
}

/** Activity when a recording stops (keeps the last status/elapsed, just inactive). */
export function stoppedActivity(activity: RecordingActivity): RecordingActivity {
  return { ...activity, active: false };
}

/**
 * Apply a recorder tick. Returns the next activity and whether it changed enough
 * to warrant a re-broadcast — i.e. the status flipped (pause/resume/saving), the
 * whole-second timer advanced or the mic's meter bars moved. A tick that changes none
 * of them (the engine reports ~10/s) is a no-op so we never spam every window. While inactive, ticks are ignored.
 */
export function applyTick(
  activity: RecordingActivity,
  tick: RecordingTick,
): { activity: RecordingActivity; changed: boolean } {
  if (!activity.active) return { activity, changed: false };
  const systemAudioAvailable = tick.systemAudioAvailable ?? activity.systemAudioAvailable;
  const micLevels = tick.micLevels ?? activity.micLevels;
  const changed =
    tick.status !== activity.status ||
    tick.elapsedSeconds !== activity.elapsedSeconds ||
    systemAudioAvailable !== activity.systemAudioAvailable ||
    !sameLevels(micLevels, activity.micLevels);
  if (!changed) return { activity, changed: false };
  const next: RecordingActivity = {
    ...activity,
    status: tick.status,
    elapsedSeconds: tick.elapsedSeconds,
  };
  if (systemAudioAvailable !== undefined) next.systemAudioAvailable = systemAudioAvailable;
  if (micLevels !== undefined) next.micLevels = micLevels;
  return { activity: next, changed: true };
}

function sameLevels(a: number[] | undefined, b: number[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, i) => value === b[i]);
}
