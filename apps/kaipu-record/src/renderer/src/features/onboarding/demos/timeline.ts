/**
 * Keyframe builder for the onboarding demos. Pure functions, no React.
 *
 * Each demo is a small choreography: elements appear, move and fade at fixed seconds
 * inside one loop of `T` seconds. `K` turns a list of `[second, css]` points into a
 * `@keyframes` rule (collected for one `<style>` element) and returns the matching
 * `animation` shorthand. Port of the design mock's helpers, same formulas.
 *
 * Reduced motion: with `frozenAt` set, every shorthand gets a negative delay and
 * `paused`, so the browser shows the scene as it looks at that second and never
 * advances it.
 */

export interface KeyframeOptions {
  /** Seconds a state takes to blend into the next point. Default .35. */
  tr?: number;
  /** Timing function. Default is the mock's ease-in-out curve. */
  ease?: string;
}

export type KeyframePoint = readonly [seconds: number, css: string];

export interface Timeline {
  /** True when the timeline renders a still frame (reduced motion). */
  readonly frozen: boolean;
  /** Keyframes + shorthand for a list of `[second, css]` points. */
  K(name: string, T: number, pts: readonly KeyframePoint[], opts?: KeyframeOptions): string;
  /** Fade (or pop) in at `a`, optionally out at `b`. `a <= 0` means visible from the start. */
  vis(name: string, T: number, a: number, b?: number | null, pop?: boolean): string;
  /** Click ring that pulses at each second in `ts`. */
  ringK(name: string, T: number, ts: readonly number[]): string;
  /**
   * Looping animation of a keyframe defined elsewhere (`SHARED_KEYFRAMES`). Frozen, it
   * pauses `frozenPhase` seconds into its loop so the bars do not all freeze at one height.
   */
  loop(name: string, durationS: number, ease: string, delayS: number, frozenPhase?: number): string;
  /** Every `@keyframes` rule generated so far, as one CSS string. */
  css(): string;
}

export const KEYFRAME_PREFIX = "kd-";

/** The two loops the mock defines globally: audio-level bars and the REC dot. */
export const SHARED_KEYFRAMES = [
  "@keyframes kd-kbnc{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}",
  "@keyframes kd-kblink{0%,100%{opacity:1}50%{opacity:.25}}",
].join("\n");

const DEFAULT_EASE = "cubic-bezier(.45,0,.2,1)";

/** Seconds left before the loop wraps when freezing, so the frame is never the reset one. */
const FREEZE_MARGIN_S = 0.05;

const pc = (t: number, T: number): string =>
  `${Math.max(0, Math.min(100, (t / T) * 100)).toFixed(2)}%`;

const round = (n: number): number => Number(n.toFixed(3));

/**
 * `kd-` plus the name, with anything that is not valid in a CSS identifier replaced.
 * The mock names the ruler highlight after a fractional slot (`ctl6.5`), which CSS reads
 * as the identifier `ctl6` followed by the number `.5`: the animation never applied.
 */
function keyframeName(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return safe.startsWith(KEYFRAME_PREFIX) ? safe : `${KEYFRAME_PREFIX}${safe}`;
}

export function createTimeline({ frozenAt }: { frozenAt?: number } = {}): Timeline {
  const rules: string[] = [];
  const frozen = frozenAt !== undefined;

  /** The `delay ` token, or `""`, and the trailing ` paused`, or `""`. */
  const freeze = (T: number, phaseS?: number): { delay: string; paused: string } => {
    if (!frozen) return { delay: "", paused: "" };
    const at = phaseS ?? Math.max(0, Math.min(frozenAt, T - FREEZE_MARGIN_S));
    return { delay: `${-round(at)}s `, paused: " paused" };
  };

  const K: Timeline["K"] = (name, T, pts, opts = {}) => {
    const tr = opts.tr ?? 0.35;
    const kf = keyframeName(name);
    let out = `@keyframes ${kf}{`;
    let prev: string | null = null;
    let pt = 0;
    for (const [t, c] of pts) {
      if (prev !== null) out += `${pc(Math.max(pt + 0.01, t - tr), T)}{${prev}}`;
      out += `${pc(t, T)}{${c}}`;
      prev = c;
      pt = t;
    }
    if (pt < T) out += `100%{${prev}}`;
    rules.push(`${out}}`);
    const { delay, paused } = freeze(T);
    return `${kf} ${T}s ${opts.ease ?? DEFAULT_EASE} ${delay}infinite both${paused}`;
  };

  const vis: Timeline["vis"] = (name, T, a, b, pop) => {
    const off = pop ? "opacity:0;transform:scale(.6)" : "opacity:0";
    const on = pop ? "opacity:1;transform:scale(1)" : "opacity:1";
    const out = pop ? "opacity:0;transform:scale(1)" : "opacity:0";
    const pts: KeyframePoint[] =
      a <= 0
        ? b == null
          ? [[0, on]]
          : [
              [0, on],
              [b, out],
            ]
        : b != null
          ? [
              [0, off],
              [a, on],
              [b, out],
            ]
          : [
              [0, off],
              [a, on],
            ];
    return K(name, T, pts, { tr: pop ? 0.28 : 0.3 });
  };

  const ringK: Timeline["ringK"] = (name, T, ts) => {
    const kf = keyframeName(name);
    let out = `@keyframes ${kf}{0%{opacity:0;transform:scale(.3)}`;
    for (const t of ts) {
      out += `${pc(t - 0.02, T)}{opacity:0;transform:scale(.3)}`;
      out += `${pc(t + 0.07, T)}{opacity:.95;transform:scale(1)}`;
      out += `${pc(t + 0.26, T)}{opacity:0;transform:scale(2.6)}`;
    }
    rules.push(`${out}100%{opacity:0;transform:scale(2.6)}}`);
    const { delay, paused } = freeze(T);
    return `${kf} ${T}s ease-out ${delay}infinite both${paused}`;
  };

  const loop: Timeline["loop"] = (name, durationS, ease, delayS, frozenPhase = 0) => {
    const kf = keyframeName(name);
    if (!frozen) return `${kf} ${round(durationS)}s ${ease} ${round(delayS)}s infinite`;
    return `${kf} ${round(durationS)}s ${ease} ${-round(frozenPhase)}s infinite paused`;
  };

  return { frozen, K, vis, ringK, loop, css: () => rules.join("\n") };
}
