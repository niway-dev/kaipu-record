import type { WorkspaceStamp } from "./types/workspaces";

/**
 * The stamp a window holds and the guard around a switch (ADR 0032), kept free of Electron so
 * it can be tested. The preload owns one instance. Types only from other modules: this file
 * is bundled into the preload (see the `src/shared` rule in CLAUDE.md).
 */
export class WorkspaceStampGuard {
  private current: WorkspaceStamp | null;
  private isSwitching = false;

  constructor(initial: WorkspaceStamp | null) {
    this.current = initial;
  }

  get stamp(): WorkspaceStamp | null {
    return this.current;
  }

  /** Between this window's prepare answer and the switch's end: item calls are refused here. */
  get switching(): boolean {
    return this.isSwitching;
  }

  /** A learned stamp when the synchronous read failed; never replaces one already held. */
  adopt(stamp: WorkspaceStamp): void {
    this.current ??= stamp;
  }

  /**
   * Every `workspaces:changed` replaces the stamp, but only the broadcast that moves the
   * workspace or its generation ends a switch: registry edits and lock changes broadcast
   * under the same stamp while a switch may still be under way.
   */
  changed(state: { activeId: string; generation: number }): void {
    const next = { workspaceId: state.activeId, generation: state.generation };
    if (!this.isCurrent(next)) this.isSwitching = false;
    this.current = next;
  }

  /** The switch was called off (`workspaces:prepare-abort`). */
  abort(): void {
    this.isSwitching = false;
  }

  /** This window answered a prepare request: from a yes until the switch ends, calls are refused. */
  prepared(ok: boolean): void {
    if (ok) this.isSwitching = true;
  }

  /** Is `stamp` still the one this window holds? */
  isCurrent(stamp: WorkspaceStamp | null): boolean {
    const held = this.current;
    return (
      stamp !== null &&
      held !== null &&
      held.workspaceId === stamp.workspaceId &&
      held.generation === stamp.generation
    );
  }
}
