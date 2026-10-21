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
 * to warrant a re-broadcast — i.e. the status flipped (pause/resume/saving) or the
 * whole-second timer advanced. A same-second tick (the engine reports ~10/s) is a
 * no-op so we never spam every window. While inactive, ticks are ignored.
 */
export function applyTick(
  activity: RecordingActivity,
  tick: RecordingTick,
): { activity: RecordingActivity; changed: boolean } {
  if (!activity.active) return { activity, changed: false };
  const systemAudioAvailable = tick.systemAudioAvailable ?? activity.systemAudioAvailable;
  const changed =
    tick.status !== activity.status ||
    tick.elapsedSeconds !== activity.elapsedSeconds ||
    systemAudioAvailable !== activity.systemAudioAvailable;
  if (!changed) return { activity, changed: false };
  const next: RecordingActivity = {
    ...activity,
    status: tick.status,
    elapsedSeconds: tick.elapsedSeconds,
  };
  if (systemAudioAvailable !== undefined) next.systemAudioAvailable = systemAudioAvailable;
  return { activity: next, changed: true };
}
