/**
 * The editor's filmstrip frames (ADR 0064, layer 3): layer 1's {@link FrameStore} with what the
 * UI needs around it. It mints one object URL per frame the worker posts, revokes it when the
 * store lets the frame go, publishes arrivals in batches, and tells each file's subscribers
 * separately, so a frame of one recording never re-renders the tiles of another (spec, decision 8).
 *
 * No DOM: the object URL functions and the timers are injected, so it runs under test with fakes.
 */
import { FrameStore, type Frame, type TimeRange } from "./filmstrip-frames";

/** A frame the UI can draw: its true timestamp in the file's own time and the object URL. */
export type StoredFrame = Frame<string>;

/** Frames are published to subscribers at most this often (decision 8). */
export const PUBLISH_MS = 150;

/**
 * An evicted frame's URL is revoked this long after the snapshot that drops it was published, so a
 * tile that has not re-rendered yet still resolves the image it shows.
 */
export const REVOKE_GRACE_MS = 2000;

export interface FilmstripTimers {
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: FilmstripTimers = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface FilmstripStoreOptions {
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
  budgetBytes?: number;
  timers?: FilmstripTimers;
  publishMs?: number;
  revokeGraceMs?: number;
}

const NO_FRAMES: readonly StoredFrame[] = Object.freeze([]);

export class FilmstripStore {
  private readonly frameStore: FrameStore<string>;
  private readonly options: FilmstripStoreOptions;
  private readonly timers: FilmstripTimers;
  private readonly publishMs: number;
  private readonly revokeGraceMs: number;
  private readonly published = new Map<string, readonly StoredFrame[]>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly dirty = new Set<string>();
  private readonly revokeQueue: string[] = [];
  private publishTimer: unknown = null;
  private revokeTimer: unknown = null;
  private lastPublish = -Infinity;

  constructor(options: FilmstripStoreOptions) {
    this.options = options;
    this.timers = options.timers ?? realTimers;
    this.publishMs = options.publishMs ?? PUBLISH_MS;
    this.revokeGraceMs = options.revokeGraceMs ?? REVOKE_GRACE_MS;
    this.frameStore = new FrameStore<string>({
      budgetBytes: options.budgetBytes,
      onEvict: (fileKey, frame) => {
        this.dirty.add(fileKey);
        // Never publish from here: the FrameStore is in the middle of an add or a clear.
        this.revokeQueue.push(frame.data);
      },
    });
  }

  /** Thumbnail bytes held right now (AC5 reads it). */
  get bytes(): number {
    return this.frameStore.bytes;
  }

  /** What the tiles draw: the last published snapshot of the file's frames, by timestamp. */
  frames(fileKey: string): readonly StoredFrame[] {
    return this.published.get(fileKey) ?? NO_FRAMES;
  }

  /** What the planner reads: every frame stored so far, published or not. */
  liveFrames(fileKey: string): readonly StoredFrame[] {
    return this.frameStore.frames(fileKey);
  }

  /** Calls `listener` when this file's published frames change. Returns the unsubscribe. */
  subscribe(fileKey: string, listener: () => void): () => void {
    let set = this.listeners.get(fileKey);
    if (!set) {
      set = new Set();
      this.listeners.set(fileKey, set);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(fileKey);
      current?.delete(listener);
      if (current?.size === 0) this.listeners.delete(fileKey);
    };
  }

  /** Keeps a frame the worker posted. The store owns the object URL it mints from the blob. */
  add(
    fileKey: string,
    frame: { timestamp: number; blob: Blob; bytes: number },
    view?: TimeRange,
  ): void {
    const url = this.options.createUrl(frame.blob);
    this.dirty.add(fileKey);
    this.frameStore.add(
      fileKey,
      { timestamp: frame.timestamp, bytes: frame.bytes, data: url },
      view,
    );
    this.requestPublish();
  }

  /**
   * Empties the store (a workspace switch, AC10): every frame goes, every URL is revoked now and
   * every subscriber is told at once, so no tile keeps showing another workspace's frame.
   */
  clear(): void {
    this.frameStore.clear(); // reports each frame through onEvict, which queues its URL
    this.cancelPublishTimer();
    this.publishNow();
    this.lastPublish = -Infinity; // a clear is not a batch: the next frame shows at once
    this.flushRevokes();
  }

  /** Stops the timers and revokes everything still queued (the editor is going away for good). */
  dispose(): void {
    this.clear();
    if (this.revokeTimer !== null) this.timers.clear(this.revokeTimer);
    this.revokeTimer = null;
  }

  // -------------------------------------------------------------------------------------

  /** Publishes now when the last publish is old enough, else once the interval has passed. */
  private requestPublish(): void {
    if (this.publishTimer !== null) return;
    const wait = this.lastPublish + this.publishMs - this.timers.now();
    if (wait <= 0) {
      this.publishNow();
      return;
    }
    this.publishTimer = this.timers.set(() => {
      this.publishTimer = null;
      this.publishNow();
    }, wait);
  }

  private cancelPublishTimer(): void {
    if (this.publishTimer !== null) this.timers.clear(this.publishTimer);
    this.publishTimer = null;
  }

  private publishNow(): void {
    this.lastPublish = this.timers.now();
    const files = [...this.dirty];
    this.dirty.clear();
    for (const fileKey of files) {
      const live = this.frameStore.frames(fileKey);
      if (live.length === 0) this.published.delete(fileKey);
      else this.published.set(fileKey, live);
    }
    for (const fileKey of files) {
      for (const listener of Array.from(this.listeners.get(fileKey) ?? [])) listener();
    }
    if (this.revokeQueue.length > 0 && this.revokeTimer === null) {
      this.revokeTimer = this.timers.set(() => {
        this.revokeTimer = null;
        this.flushRevokes();
      }, this.revokeGraceMs);
    }
  }

  private flushRevokes(): void {
    for (const url of this.revokeQueue.splice(0)) this.options.revokeUrl(url);
  }
}
