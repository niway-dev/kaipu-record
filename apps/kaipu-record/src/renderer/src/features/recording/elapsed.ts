/**
 * Pure recording clock. Tracks elapsed time excluding any paused spans, so the
 * control-bar timer matches the actual captured duration. No timers, no Date —
 * the caller passes `now` (ms), which makes it trivially testable.
 */
export interface ElapsedState {
  startedAt: number;
  totalPausedMs: number;
  pausedAt: number | null;
}

export function startElapsed(now: number): ElapsedState {
  return { startedAt: now, totalPausedMs: 0, pausedAt: null };
}

export function pauseElapsed(state: ElapsedState, now: number): ElapsedState {
  if (state.pausedAt !== null) return state;
  return { ...state, pausedAt: now };
}

export function resumeElapsed(state: ElapsedState, now: number): ElapsedState {
  if (state.pausedAt === null) return state;
  return {
    ...state,
    totalPausedMs: state.totalPausedMs + (now - state.pausedAt),
    pausedAt: null,
  };
}

export function elapsedMs(state: ElapsedState, now: number): number {
  const openPause = state.pausedAt === null ? 0 : now - state.pausedAt;
  return Math.max(0, now - state.startedAt - state.totalPausedMs - openPause);
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
