/**
 * The export's frame-rate cap (NIW2-218 quality tiers, 24 fps). Pure and DOM-free: the export
 * worker imports it.
 *
 * The output timeline is cut into slots of `1 / maxFps` seconds, and each frame goes to its
 * NEAREST slot; the first frame in a slot is kept and later ones are dropped. So the output
 * never carries more than `maxFps` frames a second, and a source at any rate lands on it:
 * 48 fps keeps every other frame, 30 fps keeps four in five, 60 fps two in five.
 *
 * It replaces a "next frame no sooner than 1/maxFps after the last kept one" rule, which
 * halved any source slower than twice the cap: a 30 fps recording (the default recording
 * quality) exported at 15 fps under a 24 fps cap, and a 24 fps one with capture jitter lost
 * frames that came a hair early. Rounding to the nearest slot absorbs that jitter.
 *
 * Kept frames stay monotonic, and each one lasts until the next (the muxer derives sample
 * durations from timestamp deltas), so the timeline length is unchanged.
 */
export interface FrameRateCap {
  /** True when the frame at output time `outTs` (seconds) should be encoded. */
  keep(outTs: number): boolean;
}

/** null keeps every frame. */
export function createFrameRateCap(maxFps: number | null): FrameRateCap {
  if (maxFps === null || maxFps <= 0) return { keep: () => true };
  let lastSlot = -Infinity;
  return {
    keep(outTs) {
      const slot = Math.round(outTs * maxFps);
      if (slot <= lastSlot) return false;
      lastSlot = slot;
      return true;
    },
  };
}

/** Slides are synthesized frames: generate them at the cap rather than drop them. */
export function cappedSlideFps(slideFps: number, maxFps: number | null): number {
  return maxFps !== null && maxFps > 0 ? Math.min(slideFps, maxFps) : slideFps;
}
