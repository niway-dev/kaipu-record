import { vi } from "vitest";
import type { SwitchElement } from "./media-switch";
import type { SceneSource } from "./scene";

/** A stand-in for a <video>: only what the switch touches, with real-ish play/pause/seek. */
export class FakeVideo {
  paused = true;
  muted = false;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  preservesPitch = true;
  readyState = 4;
  seeking = false;
  videoWidth = 1920;
  videoHeight = 1080;
  style = { visibility: "" };
  seekWrites: number[] = [];
  private time = 0;
  private listeners = new Map<string, Set<() => void>>();
  private frames = new Map<number, VideoFrameRequestCallback>();
  private nextFrame = 1;
  cancelled: number[] = [];

  get currentTime(): number {
    return this.time;
  }
  set currentTime(value: number) {
    this.time = value;
    this.seekWrites.push(value);
  }
  play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  requestVideoFrameCallback(callback: VideoFrameRequestCallback): number {
    const id = this.nextFrame++;
    this.frames.set(id, callback);
    return id;
  }
  cancelVideoFrameCallback(id: number): void {
    this.cancelled.push(id);
    this.frames.delete(id);
  }
  /** How many listeners are registered for `type` (0 once the switch has unbound it). */
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
  /** Present a frame at local `mediaTime`: every pending callback fires once. */
  presentFrame(mediaTime: number): void {
    const pending = [...this.frames.entries()];
    this.frames.clear();
    for (const [, callback] of pending) {
      callback(0, { mediaTime } as VideoFrameCallbackMetadata);
    }
  }
  get pendingFrames(): number {
    return this.frames.size;
  }
  /** A seek the element has not finished. */
  startSeek(): void {
    this.seeking = true;
  }
  finishSeek(): void {
    this.seeking = false;
    this.emit("seeked");
  }
}

export const asElement = (video: FakeVideo): SwitchElement => video as unknown as SwitchElement;

export const joinedSource = (id: string, offset: number, durationSeconds: number): SceneSource => ({
  id,
  assetId: `asset-${id}`,
  title: id,
  offset,
  durationSeconds,
  width: 1280,
  height: 720,
});
