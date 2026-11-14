/**
 * One "video" over several recordings (ADR 0058). The preview plays a sequence whose clips come
 * from the opened recording and from recordings joined after it, each with its own file and
 * `<video>`. `MediaSwitch` wraps those elements and looks like a single one that speaks AXIS
 * seconds, so the playback hook, the frame clock and every preview layer keep their logic on
 * axis time and never ask "which element".
 *
 * - Writing `currentTime` with an axis second inside another recording's range makes that
 *   recording's element the active one: shown, played if the previous one was playing, with the
 *   previous one paused, muted and hidden. Reading it adds the active recording's offset back.
 * - `prime(axisTime)` pre-seeks the other element to a coming clip's first frame, so the switch
 *   at a cut is a visibility flip plus `play()`, with no seek.
 * - A recording with NO element (missing, or still loading) is a silent wall clock: the hook
 *   can play through it like a slide of its length, and nothing is drawn.
 * - Events and frame callbacks of an element that is not the active one are dropped: a standby
 *   that pauses or presents a primed frame says nothing about what is on screen.
 *
 * Pure TypeScript (no React, no DOM beyond the element members used), tested with fakes.
 */
import type { PreviewMedia } from "./playback-media";
import { recordingAt, type SourceAxis } from "./source-axis";

/** The part of `HTMLVideoElement` the switch drives. */
export interface SwitchElement {
  currentTime: number;
  readonly paused: boolean;
  muted: boolean;
  playbackRate: number;
  defaultPlaybackRate: number;
  preservesPitch: boolean;
  readonly readyState: number;
  readonly seeking: boolean;
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly style: { visibility: string };
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  requestVideoFrameCallback?(callback: VideoFrameRequestCallback): number;
  cancelVideoFrameCallback?(handle: number): void;
}

/** What an element and a silent clock share: the transport the hook reads and writes. */
interface Medium {
  currentTime: number;
  readonly paused: boolean;
  muted: boolean;
  playbackRate: number;
  defaultPlaybackRate: number;
  preservesPitch: boolean;
  readonly readyState: number;
  readonly seeking: boolean;
  readonly videoWidth: number;
  readonly videoHeight: number;
  play(): Promise<void>;
  pause(): void;
}

/**
 * Two elements' times are "the same place" within this: a primed standby already sits on the
 * clip's first frame, and writing `currentTime` again would restart its seek and stall.
 */
const PRIME_TOLERANCE_SECONDS = 0.05;
/** `HAVE_CURRENT_DATA`: the element holds the frame at its current position. */
const HAVE_CURRENT_DATA = 2;

/**
 * A recording that cannot be shown: a wall clock with the transport of a media element,
 * limited to the recording's own length. It only exists so the hook has something to play.
 */
class SilentClock implements Medium {
  muted = false;
  defaultPlaybackRate = 1;
  preservesPitch = true;
  readonly readyState = 4;
  readonly seeking = false;
  readonly videoWidth = 0;
  readonly videoHeight = 0;
  private base = 0;
  private startedAt: number | null = null;
  private rate = 1;

  constructor(
    private readonly now: () => number,
    private readonly length: () => number,
  ) {}

  private running(): number {
    return this.startedAt === null ? 0 : ((this.now() - this.startedAt) / 1000) * this.rate;
  }
  get currentTime(): number {
    return Math.min(this.length(), this.base + this.running());
  }
  set currentTime(value: number) {
    this.base = value;
    if (this.startedAt !== null) this.startedAt = this.now();
  }
  get paused(): boolean {
    return this.startedAt === null;
  }
  get playbackRate(): number {
    return this.rate;
  }
  set playbackRate(value: number) {
    // Fold the elapsed part in first, so the position never jumps when the speed changes.
    this.base = this.currentTime;
    if (this.startedAt !== null) this.startedAt = this.now();
    this.rate = value;
  }
  play(): Promise<void> {
    if (this.startedAt === null) this.startedAt = this.now();
    return Promise.resolve();
  }
  pause(): void {
    this.base = this.currentTime;
    this.startedAt = null;
  }
}

interface FrameRequest {
  callback: VideoFrameRequestCallback;
  /** The id each element gave this request; one entry per element it is registered on. */
  registrations: Map<SwitchElement, { key: string | null; id: number }>;
}

export interface MediaSwitchOptions {
  /** The wall clock the silent clock reads, in ms. `performance.now` by default. */
  now?: () => number;
}

export class MediaSwitch implements PreviewMedia {
  private axis: SourceAxis = { recordings: [{ sourceId: null, offset: 0, duration: Infinity }] };
  private readonly elements = new Map<string | null, SwitchElement>();
  private readonly clocks = new Map<string | null, SilentClock>();
  private readonly now: () => number;
  private active: string | null = null;
  /** The element whose pixels are visible; null while a recording without an element is active. */
  private shown: SwitchElement | null = null;
  /** The active element, waiting for its frame before it takes the screen from `shown`. */
  private pendingShow: SwitchElement | null = null;
  private lastRate: number | null = null;
  private readonly changeListeners = new Set<() => void>();
  private readonly eventListeners = new Map<string, Set<() => void>>();
  /** What each attached element is bound to, so it can be unbound on detach. */
  private readonly bindings = new Map<SwitchElement, Map<string, () => void>>();
  private readonly frameRequests = new Map<number, FrameRequest>();
  private nextHandle = 1;

  constructor(options: MediaSwitchOptions = {}) {
    this.now = options.now ?? (() => performance.now());
  }

  // ---- wiring -------------------------------------------------------------------------

  /** The scene's axis changed (a join, an undone join). The opened recording is always there. */
  setAxis(axis: SourceAxis): void {
    this.axis = axis;
    if (!axis.recordings.some((r) => r.sourceId === this.active)) this.fallBack();
  }

  /** Register (or, with null, remove) the element playing the recording `key` (null = opened). */
  attach(key: string | null, element: SwitchElement | null): void {
    const previous = this.elements.get(key);
    if (previous && previous !== element) this.unbind(previous);
    if (element === null) {
      const wasPlaying = previous ? !previous.paused : false;
      this.elements.delete(key);
      if (previous === this.shown) this.shown = null;
      if (previous === this.pendingShow) this.pendingShow = null;
      if (key === this.active) this.fallBack(wasPlaying);
      return;
    }
    if (previous === element) return;
    this.elements.set(key, element);
    this.bind(element);
    this.applyRate(element);
    if (key === this.active) this.takeOverFromClock(key, element);
    else element.muted = true;
    this.ensureFrameRequests(element, key);
    this.applyVisibility();
  }

  // ---- what the hook and the layers read ------------------------------------------------

  get activeKey(): string | null {
    return this.active;
  }

  /** The element whose pixels are on screen, or null for a recording without one. */
  activeElement(): HTMLVideoElement | null {
    return (this.elements.get(this.active) as unknown as HTMLVideoElement | undefined) ?? null;
  }

  isActive(element: unknown): boolean {
    return this.elements.get(this.active) === element;
  }

  get currentTime(): number {
    return this.medium(this.active).currentTime + this.offsetOf(this.active);
  }
  set currentTime(axisTime: number) {
    const found = recordingAt(this.axis, axisTime);
    // A time no range holds (a legacy clip) stays on the recording that is active.
    const key = found ? found.recording.sourceId : this.active;
    const local = found ? found.localTime : axisTime - this.offsetOf(this.active);
    if (key === this.active) this.medium(key).currentTime = local;
    else this.activate(key, local);
  }

  /**
   * The axis second of the frame ON SCREEN. It is `currentTime` except while a switch is pending
   * (the new element has no frame yet and the old picture is still shown): then it is the shown
   * element's own time, so privacy layers and the cursor keep following the picture the viewer
   * sees, not the position that was requested.
   */
  get presentedTime(): number {
    if (this.shown) {
      for (const [key, element] of this.elements) {
        if (element === this.shown) return element.currentTime + this.offsetOf(key);
      }
    }
    return this.currentTime;
  }

  get paused(): boolean {
    return this.medium(this.active).paused;
  }
  get muted(): boolean {
    return this.medium(this.active).muted;
  }
  set muted(value: boolean) {
    this.medium(this.active).muted = value;
    // The standby never makes a sound: it is already silenced, and stays so.
    for (const [key, element] of this.elements) if (key !== this.active) element.muted = true;
  }
  get playbackRate(): number {
    return this.medium(this.active).playbackRate;
  }
  set playbackRate(value: number) {
    this.lastRate = value;
    for (const medium of this.allMedia()) medium.playbackRate = value;
  }
  get defaultPlaybackRate(): number {
    return this.medium(this.active).defaultPlaybackRate;
  }
  set defaultPlaybackRate(value: number) {
    for (const medium of this.allMedia()) medium.defaultPlaybackRate = value;
  }
  get preservesPitch(): boolean {
    return this.medium(this.active).preservesPitch;
  }
  set preservesPitch(value: boolean) {
    for (const medium of this.allMedia()) medium.preservesPitch = value;
  }
  get readyState(): number {
    return this.medium(this.active).readyState;
  }
  get videoWidth(): number {
    return this.medium(this.active).videoWidth;
  }
  get videoHeight(): number {
    return this.medium(this.active).videoHeight;
  }

  play(): Promise<void> {
    return this.medium(this.active).play();
  }
  pause(): void {
    this.medium(this.active).pause();
    for (const [key, element] of this.elements) {
      if (key !== this.active && !element.paused) element.pause();
    }
  }

  // ---- priming -----------------------------------------------------------------------

  prime(axisTime: number): void {
    const found = recordingAt(this.axis, axisTime);
    if (!found || found.recording.sourceId === this.active) return;
    const element = this.elements.get(found.recording.sourceId);
    if (!element) return;
    element.muted = true;
    if (!element.paused) element.pause();
    this.applyRate(element);
    if (!sameSpot(element.currentTime, found.localTime)) element.currentTime = found.localTime;
  }

  // ---- subscriptions -----------------------------------------------------------------

  /**
   * Called once per switch of the recording, with the new time already readable in `currentTime`,
   * and again when a pending switch gets its first frame and `presentedTime` catches up.
   */
  onActiveChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  addEventListener(type: string, listener: () => void): void {
    let listeners = this.eventListeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(type, listeners);
      for (const [element] of this.attached()) this.bindEvent(element, type);
    }
    listeners.add(listener);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.eventListeners.get(type)?.delete(listener);
  }

  /**
   * Frames of the active element only, with `mediaTime` on the axis. The request goes to every
   * element: whichever is active when its frame arrives answers. A standby's frame (a primed
   * seek presents one) is dropped without spending the request on the active element, and the
   * active element's answer cancels the standby's copy so a per-frame loop never piles them up.
   */
  requestVideoFrameCallback(callback: VideoFrameRequestCallback): number {
    const handle = this.nextHandle++;
    const request: FrameRequest = { callback, registrations: new Map() };
    this.frameRequests.set(handle, request);
    for (const [element, key] of this.attached()) this.register(handle, request, element, key);
    return handle;
  }
  cancelVideoFrameCallback(handle: number): void {
    const request = this.frameRequests.get(handle);
    if (!request) return;
    this.frameRequests.delete(handle);
    for (const [element, { id }] of request.registrations) element.cancelVideoFrameCallback?.(id);
    request.registrations.clear();
  }

  // ---- internals ---------------------------------------------------------------------

  private medium(key: string | null): Medium {
    const element = this.elements.get(key);
    if (element) return element;
    let clock = this.clocks.get(key);
    if (!clock) {
      clock = new SilentClock(this.now, () => this.lengthOf(key));
      this.clocks.set(key, clock);
    }
    return clock;
  }

  private allMedia(): Medium[] {
    return [...this.elements.values(), ...this.clocks.values()];
  }

  private offsetOf(key: string | null): number {
    return this.axis.recordings.find((r) => r.sourceId === key)?.offset ?? 0;
  }

  private lengthOf(key: string | null): number {
    return this.axis.recordings.find((r) => r.sourceId === key)?.duration ?? Infinity;
  }

  private attached(): [SwitchElement, string | null][] {
    return [...this.elements].map(([key, element]) => [element, key]);
  }

  /** Switch to `key` at local second `local`. Time, transport and events follow at once. */
  private activate(key: string | null, local: number): void {
    const previousKey = this.active;
    const previous = this.medium(previousKey);
    const wasPlaying = !previous.paused;
    const muted = previous.muted;
    const next = this.medium(key);
    const nextElement = this.elements.get(key) ?? null;

    this.active = key;
    // A primed standby already sits on the first frame: only a stray position is written.
    if (!sameSpot(next.currentTime, local) || !nextElement) next.currentTime = local;
    next.muted = muted;
    if (nextElement) this.applyRate(nextElement);
    else if (this.lastRate !== null) next.playbackRate = this.lastRate;
    if (wasPlaying) void next.play().catch(() => {});
    previous.pause();
    // The standby is silent from now on, whichever way it was playing.
    if (this.elements.has(previousKey)) previous.muted = true;

    if (nextElement) {
      this.ensureFrameRequests(nextElement, key);
      if (nextElement.readyState >= HAVE_CURRENT_DATA && !nextElement.seeking) {
        this.shown = nextElement;
        this.pendingShow = null;
      } else {
        // Keep the old frame until this one has its own; never show a blank element.
        this.pendingShow = nextElement;
      }
    } else {
      this.shown = null;
      this.pendingShow = null;
    }
    this.applyVisibility();
    for (const listener of [...this.changeListeners]) listener();
  }

  /** The shown recording went away: the opened one takes the screen back. */
  private fallBack(wasPlayingBefore?: boolean): void {
    if (this.active === null) {
      this.shown = this.elements.get(null) ?? null;
      this.applyVisibility();
      return;
    }
    const previousKey = this.active;
    const previous = this.medium(previousKey);
    const wasPlaying = wasPlayingBefore ?? !previous.paused;
    previous.pause();
    // A recording that has left the scene keeps no clock behind.
    if (!this.elements.has(previousKey)) this.clocks.delete(previousKey);
    this.active = null;
    const opened = this.medium(null);
    if (wasPlaying) void opened.play().catch(() => {});
    this.shown = this.elements.get(null) ?? null;
    this.pendingShow = null;
    this.applyVisibility();
    for (const listener of [...this.changeListeners]) listener();
  }

  /** An element appears for the recording that is already active: continue where its clock was. */
  private takeOverFromClock(key: string | null, element: SwitchElement): void {
    const clock = this.clocks.get(key);
    if (clock) {
      const wasPlaying = !clock.paused;
      if (clock.currentTime > 0) element.currentTime = clock.currentTime;
      clock.pause();
      this.clocks.delete(key);
      if (wasPlaying) void element.play().catch(() => {});
    }
    this.shown = element;
    this.pendingShow = null;
  }

  /** The pending element has its frame: it takes the screen, and the layers move to its time. */
  private showPending(element: SwitchElement): void {
    this.shown = element;
    this.pendingShow = null;
    this.applyVisibility();
    for (const listener of [...this.changeListeners]) listener();
  }

  private applyVisibility(): void {
    for (const element of this.elements.values()) {
      element.style.visibility = element === this.shown ? "visible" : "hidden";
    }
  }

  private applyRate(element: SwitchElement): void {
    if (this.lastRate === null) return;
    if (element.defaultPlaybackRate !== this.lastRate) element.defaultPlaybackRate = this.lastRate;
    if (element.playbackRate !== this.lastRate) element.playbackRate = this.lastRate;
  }

  private bind(element: SwitchElement): void {
    const handlers = new Map<string, () => void>();
    this.bindings.set(element, handlers);
    // The switch's own: a frame to show, and a src that reloaded (it lost the chosen rate).
    this.bindEvent(element, "seeked");
    this.bindEvent(element, "loadeddata");
    this.bindEvent(element, "loadedmetadata");
    for (const type of this.eventListeners.keys()) this.bindEvent(element, type);
  }

  private bindEvent(element: SwitchElement, type: string): void {
    const handlers = this.bindings.get(element);
    if (!handlers || handlers.has(type)) return;
    const handler = (): void => {
      if (type === "loadedmetadata") this.applyRate(element);
      if ((type === "seeked" || type === "loadeddata") && element === this.pendingShow) {
        this.showPending(element);
      }
      if (element !== this.elements.get(this.active)) return;
      for (const listener of [...(this.eventListeners.get(type) ?? [])]) listener();
    };
    handlers.set(type, handler);
    element.addEventListener(type, handler);
  }

  private unbind(element: SwitchElement): void {
    for (const [type, handler] of this.bindings.get(element) ?? []) {
      element.removeEventListener(type, handler);
    }
    this.bindings.delete(element);
    for (const request of this.frameRequests.values()) {
      const registration = request.registrations.get(element);
      if (registration) element.cancelVideoFrameCallback?.(registration.id);
      request.registrations.delete(element);
    }
  }

  private register(
    handle: number,
    request: FrameRequest,
    element: SwitchElement,
    key: string | null,
  ): void {
    if (typeof element.requestVideoFrameCallback !== "function") return;
    if (request.registrations.has(element)) return;
    const id = element.requestVideoFrameCallback((now, metadata) => {
      if (this.frameRequests.get(handle) !== request) return;
      if (this.elements.get(this.active) !== element) {
        // Not on screen: this copy is spent, the request lives on in the others.
        request.registrations.delete(element);
        return;
      }
      // A frame of the switch's target before its seeked/loadeddata event: it is on screen now.
      if (
        element === this.pendingShow &&
        element.readyState >= HAVE_CURRENT_DATA &&
        !element.seeking
      ) {
        this.showPending(element);
      }
      this.frameRequests.delete(handle);
      for (const [other, { id: otherId }] of request.registrations) {
        if (other !== element) other.cancelVideoFrameCallback?.(otherId);
      }
      request.registrations.clear();
      request.callback(now, { ...metadata, mediaTime: metadata.mediaTime + this.offsetOf(key) });
    });
    request.registrations.set(element, { key, id });
  }

  /** Every pending request must have a copy on `element`: it may be about to be on screen. */
  private ensureFrameRequests(element: SwitchElement, key: string | null): void {
    for (const [handle, request] of this.frameRequests) {
      this.register(handle, request, element, key);
    }
  }
}

function sameSpot(a: number, b: number): boolean {
  return Math.abs(a - b) < PRIME_TOLERANCE_SECONDS;
}
