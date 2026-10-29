/**
 * The app's shutdown sequence: explicit, idempotent, with a deadline.
 *
 * `app.quit()` is not a kill. Electron runs `before-quit`, then closes every window one by
 * one (each close asks its renderer `beforeunload` and waits), and only when none is left
 * fires `will-quit` and ends the process. Anything that does not answer keeps the process
 * alive with no window and no tray icon: a ghost (NIW2-548). The usual culprits are a
 * renderer that never answers, a native hook that is wedged, and a window created after the
 * quit began, which was not in the list Electron set out to close.
 *
 * So the app does what Chromium and VS Code do with their own shutdown: everything the app
 * opened registers a `dispose` here; `begin()` runs them in reverse order of registration
 * and arms a deadline; `finish()` (Electron's `will-quit`) disarms it; and if the deadline
 * passes, the process logs what is still open and exits without waiting for anyone. The
 * deadline is the net, not the mechanism: a quit that reaches it is a defect to fix, and
 * the log line names what kept it open.
 *
 * Pure: no Electron import, so the sequence is unit-tested with fakes. `app-shutdown.ts`
 * wires it to the real app.
 */

/** How long a quit may take after `begin()` before the process exits on its own. */
export const QUIT_DEADLINE_MS = 5_000;

/** The start of the log line written when the deadline passes; the E2E harness looks for it. */
export const SHUTDOWN_DEADLINE_MARKER = "[shutdown] deadline";

export interface ShutdownParticipant {
  /** Named in the log when its `dispose` throws. */
  name: string;
  /** Release what the participant holds: destroy windows, stop hooks, clear timers. Sync. */
  dispose(): void;
}

export interface ShutdownDeps {
  deadlineMs: number;
  log(message: string): void;
  /** One line per window still open, for the deadline's log. */
  openWindows(): string[];
  /** End the process without waiting for anything else (`app.exit`). */
  exit(): void;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export class AppShutdown {
  private participants: ShutdownParticipant[] = [];
  private quitting = false;
  private deadline: unknown = null;

  constructor(private readonly deps: ShutdownDeps) {}

  /** True from `begin()` on. Creators of windows and timers check it and do nothing. */
  isQuitting(): boolean {
    return this.quitting;
  }

  /**
   * Add something to release on quit. Returns the unregister function. A participant that
   * arrives after the quit began is disposed at once: late creators must not outlive the quit.
   */
  register(participant: ShutdownParticipant): () => void {
    if (this.quitting) {
      this.dispose(participant);
      return () => {};
    }
    this.participants.push(participant);
    return () => {
      this.participants = this.participants.filter((candidate) => candidate !== participant);
    };
  }

  /**
   * Release everything, newest first, and arm the deadline. Idempotent: a second call (a
   * second `before-quit`, a guard that re-quits) does nothing.
   */
  begin(): void {
    if (this.quitting) return;
    this.quitting = true;
    const participants = this.participants.reverse();
    this.participants = [];
    for (const participant of participants) this.dispose(participant);
    this.deadline = this.deps.setTimer(() => this.onDeadline(), this.deps.deadlineMs);
  }

  /** The quit went through (`will-quit`): the deadline is no longer needed. */
  finish(): void {
    if (this.deadline === null) return;
    this.deps.clearTimer(this.deadline);
    this.deadline = null;
  }

  private dispose(participant: ShutdownParticipant): void {
    try {
      participant.dispose();
    } catch (error) {
      this.deps.log(`[shutdown] ${participant.name} failed to dispose: ${describe(error)}`);
    }
  }

  private onDeadline(): void {
    this.deadline = null;
    const windows = this.deps.openWindows();
    this.deps.log(
      `${SHUTDOWN_DEADLINE_MARKER}: the quit did not finish within ${this.deps.deadlineMs} ms; ` +
        `${windows.length} window(s) still open: ${windows.join("; ") || "none"}. Exiting.`,
    );
    this.deps.exit();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
