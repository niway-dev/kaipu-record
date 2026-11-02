import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicWriteFile } from "../library/atomic-write";
import type { AssignOutcome } from "./assign-client";

/**
 * Cloud assignments this Mac still owes the server (ADR 0033, the cloud step of a move): after
 * a move commits, the item's cloud asset must say its new workspace. That call is best effort:
 * it never blocks or fails the move. It goes through this queue, kept in userData, retried with
 * a backoff until the server confirms, and survives a restart. Until then `pending()` overlays
 * the cached catalog (`workspace-filter.ts`), so an offline move never shows the item in its
 * old workspace's cloud listing.
 */

interface QueuedAssignment {
  assetId: string;
  workspaceId: string | null;
  attempts: number;
  /** Epoch ms; not sent before. */
  nextAttemptAt: number;
}

interface QueueFile {
  version: 1;
  entries: QueuedAssignment[];
}

export interface AssignQueueDeps {
  /** `userData/cloud-assign-queue.json`. */
  file: string;
  account(): { userId: string; token: string } | null;
  assign(token: string, assetId: string, workspaceId: string | null): Promise<AssignOutcome>;
  /** The server holds it: the cached catalog entry takes the new workspace. */
  onConfirmed(assetId: string, workspaceId: string | null): Promise<void>;
  now?(): number;
  /** Call `run` in `ms` (a timer in the app; nothing in a test). */
  schedule?(run: () => void, ms: number): void;
}

const MAX_DELAY_MS = 60 * 60 * 1000;

/** 30 s, 1 min, 2 min … capped at an hour. */
export function retryDelayMs(attempts: number): number {
  return Math.min(MAX_DELAY_MS, 30_000 * 2 ** Math.max(0, attempts - 1));
}

const defaultSchedule = (run: () => void, ms: number): void => {
  setTimeout(run, ms).unref?.();
};

export class AssignQueue {
  private entries: QueuedAssignment[] = [];
  private running: Promise<void> | null = null;
  private timerAt: number | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: AssignQueueDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Read the file. A missing or unreadable one starts empty. */
  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.deps.file, "utf-8")) as QueueFile;
      this.entries =
        parsed.version === 1 && Array.isArray(parsed.entries)
          ? parsed.entries.filter(
              (e) =>
                typeof e?.assetId === "string" &&
                (typeof e.workspaceId === "string" || e.workspaceId === null),
            )
          : [];
    } catch {
      this.entries = [];
    }
  }

  /** assetId → workspace, for every assignment the server has not confirmed. */
  pending(): ReadonlyMap<string, string | null> {
    return new Map(this.entries.map((e) => [e.assetId, e.workspaceId] as const));
  }

  /** Owe the server this assignment (replacing an older one of the asset) and try at once. */
  async enqueue(assetId: string, workspaceId: string | null): Promise<void> {
    this.entries = this.entries.filter((e) => e.assetId !== assetId);
    this.entries.push({ assetId, workspaceId, attempts: 0, nextAttemptAt: 0 });
    await this.save();
    await this.process();
  }

  /** Owe the server this assignment, which was just tried and not answered: retried later. */
  async defer(assetId: string, workspaceId: string | null): Promise<void> {
    this.entries = this.entries.filter((e) => e.assetId !== assetId);
    this.entries.push({
      assetId,
      workspaceId,
      attempts: 1,
      nextAttemptAt: this.now() + retryDelayMs(1),
    });
    await this.save();
    this.scheduleNext();
  }

  /** Send every assignment that is due. One run at a time; never throws. */
  process(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.runOnce()
      .catch((error: unknown) => console.error("[cloud] assignment queue failed", error))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async runOnce(): Promise<void> {
    const account = this.deps.account();
    if (!account) return;
    let changed = false;
    for (const entry of this.entries.slice()) {
      if (entry.nextAttemptAt > this.now()) continue;
      const outcome = await this.deps.assign(account.token, entry.assetId, entry.workspaceId);
      // A newer enqueue of the same asset replaced this entry while it was in flight.
      const current = this.entries.find((e) => e.assetId === entry.assetId);
      if (current !== entry) continue;
      changed = true;
      if (outcome === "ok" || outcome === "not-found") {
        this.entries = this.entries.filter((e) => e !== entry);
        if (outcome === "ok") await this.deps.onConfirmed(entry.assetId, entry.workspaceId);
        continue;
      }
      entry.attempts += 1;
      entry.nextAttemptAt = this.now() + retryDelayMs(entry.attempts);
      if (outcome === "unauthorized") break; // the rest would fail the same way
    }
    if (changed) await this.save();
    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (this.entries.length === 0) return;
    const next = Math.min(...this.entries.map((e) => e.nextAttemptAt));
    if (this.timerAt !== null && this.timerAt <= next) return;
    this.timerAt = next;
    (this.deps.schedule ?? defaultSchedule)(
      () => {
        this.timerAt = null;
        void this.process();
      },
      Math.max(1_000, next - this.now()),
    );
  }

  private async save(): Promise<void> {
    try {
      await mkdir(dirname(this.deps.file), { recursive: true });
      const file: QueueFile = { version: 1, entries: this.entries };
      await atomicWriteFile(this.deps.file, JSON.stringify(file));
    } catch (error) {
      // The move is done whatever happens here; the entry stays in memory for this session.
      console.error("[cloud] could not save the assignment queue", error);
    }
  }
}
