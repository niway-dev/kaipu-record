import { VAULT_MAINTENANCE_MARKER } from "@shared/types/library-storage";

/**
 * Maintenance mode (NIW2-561, ADR 0033): one flag and one activity counter per process.
 *
 * Every operation entering the vault from outside (IPC handlers, capture starts, the
 * recording session, exports, stranded recovery, the folder change) takes a lease with
 * `admit` before any work, and releases it when everything it spawned has finished.
 * Nested work runs under the outer lease and never admits again. Vault methods take no
 * gate, so there is no nesting and no deadlock.
 *
 * "Fix all" calls `enterMaintenance`: it refuses while a recording or an export holds a
 * lease, waits (cancellably) for short operations, and sets the flag in the same
 * synchronous step as the final zero check. While the flag is set, `admit` refuses with
 * `MaintenanceError`; nothing is queued, so no stale request wakes up after the fix.
 */
export type ActivityKind =
  | "library"
  | "editor"
  | "screenshot"
  | "recording"
  | "export"
  | "recovery"
  | "folder";

/** Operations that last minutes: Fix all does not start, nor keep waiting, while one runs. */
type LongActivity = "recording" | "export";
const LONG: ReadonlySet<ActivityKind> = new Set<ActivityKind>(["recording", "export"]);

/** Refused because "Check and fix files" is running. The message carries the IPC marker. */
export class MaintenanceError extends Error {
  constructor() {
    super(`${VAULT_MAINTENANCE_MARKER}: Kaipu is fixing your files`);
    this.name = "MaintenanceError";
  }
}

/** Fix all cannot start: a recording or an export is using the vault. */
export class VaultBusyError extends Error {
  constructor(readonly activity: LongActivity) {
    super(`The vault is busy: a ${activity} is in progress`);
    this.name = "VaultBusyError";
  }
}

export class MaintenanceCancelledError extends Error {
  constructor() {
    super("Waiting for the vault to be idle was cancelled");
    this.name = "MaintenanceCancelledError";
  }
}

export class MaintenanceAlreadyRunningError extends Error {
  constructor() {
    super("Check and fix files is already running");
    this.name = "MaintenanceAlreadyRunningError";
  }
}

export interface ActivityLease {
  readonly kind: ActivityKind;
  /** Idempotent; always called in `finally`. */
  release(): void;
}

export interface EnterOptions {
  signal?: AbortSignal;
  /** The kinds still in flight, each time a lease is released while waiting (the set may repeat). */
  onWaiting?: (kinds: ActivityKind[]) => void;
}

interface Entering {
  resolve: (exit: () => void) => void;
  reject: (error: Error) => void;
  onWaiting?: (kinds: ActivityKind[]) => void;
}

export class VaultActivity {
  private maintenance = false;
  private entering: Entering | null = null;
  private readonly inFlight = new Map<ActivityKind, number>();
  private count = 0;
  private readonly endedListeners = new Set<() => void>();

  get inMaintenance(): boolean {
    return this.maintenance;
  }

  /** The kinds holding a lease right now, in a stable order. */
  active(): ActivityKind[] {
    return [...this.inFlight.keys()].sort();
  }

  /** Check the flag and count the operation in one synchronous step. */
  admit(kind: ActivityKind): ActivityLease {
    if (this.maintenance) throw new MaintenanceError();
    if (this.entering && LONG.has(kind)) {
      // A recording or export started while Fix all waited: it would wait for minutes.
      const entering = this.entering;
      this.entering = null;
      entering.reject(new VaultBusyError(kind as LongActivity));
    }
    this.count += 1;
    this.inFlight.set(kind, (this.inFlight.get(kind) ?? 0) + 1);
    let released = false;
    return {
      kind,
      release: () => {
        if (released) return;
        released = true;
        this.count -= 1;
        const left = (this.inFlight.get(kind) ?? 1) - 1;
        if (left > 0) this.inFlight.set(kind, left);
        else this.inFlight.delete(kind);
        this.settle();
      },
    };
  }

  /** `fn` under a lease, released however it ends. */
  async run<T>(kind: ActivityKind, fn: () => Promise<T> | T): Promise<T> {
    const lease = this.admit(kind);
    try {
      return await fn();
    } finally {
      lease.release();
    }
  }

  /**
   * Resolves an exit function once the flag is set; the caller runs it in `finally`.
   * Rejects with `VaultBusyError` (a recording or export), `MaintenanceCancelledError`
   * (the signal aborted while waiting) or `MaintenanceAlreadyRunningError`.
   */
  enterMaintenance(options: EnterOptions = {}): Promise<() => void> {
    if (this.maintenance || this.entering) {
      return Promise.reject(new MaintenanceAlreadyRunningError());
    }
    const long = this.active().find((kind) => LONG.has(kind));
    if (long) return Promise.reject(new VaultBusyError(long as LongActivity));
    if (options.signal?.aborted) return Promise.reject(new MaintenanceCancelledError());
    if (this.count === 0) {
      this.maintenance = true;
      return Promise.resolve(this.exitOnce());
    }
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        if (this.entering !== entering) return;
        this.entering = null;
        reject(new MaintenanceCancelledError());
      };
      const entering: Entering = {
        resolve: (exit) => {
          options.signal?.removeEventListener("abort", onAbort);
          resolve(exit);
        },
        reject: (error) => {
          options.signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
        onWaiting: options.onWaiting,
      };
      this.entering = entering;
      options.signal?.addEventListener("abort", onAbort, { once: true });
      options.onWaiting?.(this.active());
    });
  }

  /** Called when maintenance ends (the editors retry their pending saves). */
  onMaintenanceEnded(listener: () => void): () => void {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  private settle(): void {
    const entering = this.entering;
    if (!entering) return;
    if (this.count > 0) {
      entering.onWaiting?.(this.active());
      return;
    }
    // The final zero check and the flag, in one step.
    this.entering = null;
    this.maintenance = true;
    entering.resolve(this.exitOnce());
  }

  private exitOnce(): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.maintenance = false;
      for (const listener of this.endedListeners) {
        try {
          listener();
        } catch (error) {
          console.error("maintenance-ended listener failed", error);
        }
      }
    };
  }
}

/** The process' one instance: maintenance mode is per process (C6). */
export const vaultActivity = new VaultActivity();
