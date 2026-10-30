import { STALE_WORKSPACE, type WorkspaceStamp } from "@shared/types/workspaces";

/** A call made under a workspace or generation that is no longer the active one. */
export class StaleWorkspaceError extends Error {
  constructor() {
    super(STALE_WORKSPACE);
    this.name = "StaleWorkspaceError";
  }
}

function isStamp(value: unknown): value is WorkspaceStamp {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record["workspaceId"] === "string" && typeof record["generation"] === "number";
}

/**
 * The workspace gate (ADR 0032, decisions 6 and 7). Every item-scoped and tag call runs
 * inside `run(stamp, fn)`: it runs only when its stamp names the active workspace and the
 * current generation, and never while a switch is under way. A switch `close()`s the gate,
 * which waits for the calls already running, and `commit()`s the new workspace with a new
 * generation, so a call stamped before the switch is refused afterwards and writes nothing.
 * A running call therefore always sees one folder from start to end.
 */
export class WorkspaceGate {
  private activeId: string;
  private generation: number;
  private closed = false;
  private running = 0;
  private drained: Array<() => void> = [];

  constructor(activeId: string, generation = 1) {
    this.activeId = activeId;
    this.generation = generation;
  }

  get stamp(): WorkspaceStamp {
    return { workspaceId: this.activeId, generation: this.generation };
  }

  get switching(): boolean {
    return this.closed;
  }

  isCurrent(stamp: unknown): boolean {
    return (
      !this.closed &&
      isStamp(stamp) &&
      stamp.workspaceId === this.activeId &&
      stamp.generation === this.generation
    );
  }

  async run<T>(stamp: unknown, fn: () => T | Promise<T>): Promise<T> {
    if (!this.isCurrent(stamp)) throw new StaleWorkspaceError();
    return this.track(fn);
  }

  /** Main-internal work bound to a workspace id at its start (a quiet capture's toast Save). */
  async runActive<T>(workspaceId: string, fn: () => T | Promise<T>): Promise<T> {
    if (this.closed || workspaceId !== this.activeId) throw new StaleWorkspaceError();
    return this.track(fn);
  }

  private async track<T>(fn: () => T | Promise<T>): Promise<T> {
    this.running += 1;
    try {
      return await fn();
    } finally {
      this.running -= 1;
      if (this.running === 0) {
        const waiting = this.drained;
        this.drained = [];
        for (const resolve of waiting) resolve();
      }
    }
  }

  /** Refuse new calls and wait until the running ones have finished. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.running === 0) return;
    await new Promise<void>((resolve) => this.drained.push(resolve));
  }

  /** The switch was aborted: the old workspace stays active, under the same generation. */
  reopen(): void {
    this.closed = false;
  }

  /** The last step of a switch: the new workspace and a new generation, then open again. */
  commit(activeId: string): WorkspaceStamp {
    this.activeId = activeId;
    this.generation += 1;
    this.closed = false;
    return this.stamp;
  }

  /** The active entry's id changed outside a switch (a pending entry adopted its folder's id). */
  rebind(activeId: string): WorkspaceStamp {
    this.activeId = activeId;
    this.generation += 1;
    return this.stamp;
  }
}
