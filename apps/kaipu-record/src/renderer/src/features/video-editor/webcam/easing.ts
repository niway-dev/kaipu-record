/**
 * Easing curves for motion between two known states (camera sections, ADR 0039). Stateless:
 * the same `t` always gives the same value, so scrubbing backwards matches playing forwards.
 *
 * WORKER-BUNDLE INVARIANT: pure and DOM-free, so the export worker can import it. It is
 * generic on purpose (floating images can use it later), which is why it knows nothing
 * about the webcam: webcam-model.ts re-exports the preset ids.
 */

/** The presets a transition can use, in the order the inspector lists them. */
export const EASING_PRESETS = ["ease-in-out", "linear", "ease-out", "back"] as const;

export type EasingPreset = (typeof EASING_PRESETS)[number];

/** The standard easeOutBack constant: a peak of about 10 % past the target. */
const BACK_OVERSHOOT = 1.70158;
const BACK_SCALE = BACK_OVERSHOOT + 1;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * The curve's value at `t`, held to 0..1 on input. Exactly 0 at 0 and exactly 1 at 1 for every
 * preset, so a transition starts on the previous position and settles on the target with no
 * float residue. `back` goes above 1 in between.
 */
export function easeValue(easing: EasingPreset, t: number): number {
  const x = clamp01(t);
  if (x === 0) return 0;
  if (x === 1) return 1;
  switch (easing) {
    case "linear":
      return x;
    case "ease-out":
      return 1 - (1 - x) ** 3;
    case "ease-in-out":
      return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
    case "back": {
      const u = x - 1;
      return 1 + BACK_SCALE * u ** 3 + BACK_OVERSHOOT * u ** 2;
    }
  }
}

/** The curve's maximum above 1: where its derivative is zero, u = -2c / (3 (c + 1)), u = t - 1. */
const backPeak = (): number => {
  const u = (-2 * BACK_OVERSHOOT) / (3 * BACK_SCALE);
  return BACK_SCALE * u ** 3 + BACK_OVERSHOOT * u ** 2;
};

/**
 * How far above 1 each curve goes at its highest. The layout uses it to scale the overshoot
 * so that the peak, not a clamp, is what fits in the room before the frame edge.
 */
export const EASING_PEAK_OVERSHOOT: Record<EasingPreset, number> = {
  "ease-in-out": 0,
  linear: 0,
  "ease-out": 0,
  back: backPeak(),
};
