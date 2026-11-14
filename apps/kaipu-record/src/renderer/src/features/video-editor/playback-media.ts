/**
 * What the preview's consumers read from "the video": a structural subset of
 * `HTMLVideoElement`, so a plain element satisfies it (the Library's player, most tests) and so
 * does the `MediaSwitch`, which speaks AXIS seconds over one element per recording (ADR 0058).
 *
 * `currentTime` here is always a second on the scene's source axis. For the opened recording
 * that is the element's own time; for a joined one the switch adds the recording's offset.
 */

/** The members the playback hook drives. */
export type PlaybackMedia = Pick<
  HTMLVideoElement,
  | "currentTime"
  | "paused"
  | "muted"
  | "playbackRate"
  | "defaultPlaybackRate"
  | "preservesPitch"
  | "play"
  | "pause"
> & {
  /**
   * Get the recording that holds `axisTime` ready to be shown without a stall (seeked, paused,
   * muted). Optional: a bare element has nothing to prepare, and the switch ignores a time in
   * the recording it is already showing.
   */
  prime?(axisTime: number): void;
};

/** What the frame clock subscribes to. */
export type FrameSource = Pick<HTMLVideoElement, "currentTime"> & {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  requestVideoFrameCallback?(callback: VideoFrameRequestCallback): number;
  cancelVideoFrameCallback?(handle: number): void;
  /** The recording on screen changed (the switch only); the clock re-applies at once. */
  onActiveChange?(listener: () => void): () => void;
};

/** Everything a preview layer reads: the clock, the transport state and the frame's size. */
export type PreviewMedia = PlaybackMedia &
  FrameSource &
  Pick<HTMLVideoElement, "readyState" | "videoWidth" | "videoHeight"> & {
    /**
     * The element whose pixels are on screen, or null when the recording has no element (a
     * missing one). A canvas that samples the picture draws from this, never from the switch.
     */
    activeElement?(): HTMLVideoElement | null;
  };
