/**
 * "Lower it while I talk": the decision of when the system audio ducks under the voice.
 * Pure (no Web Audio, no timers) so the engine's 50 ms loop only measures and applies,
 * and the timing rules are unit-tested with plain numbers.
 */

/** Mic RMS above this counts as talking. Low enough for quiet speech, above room hiss. */
export const DUCK_THRESHOLD_DBFS = -40;
/** The system audio's gain while ducked. */
export const DUCK_GAIN = 0.3;
/** How fast the gain falls to {@link DUCK_GAIN} once the voice starts. */
export const DUCK_ATTACK_MS = 80;
/** How long the mic must stay below the threshold before the gain returns: no pumping between words. */
export const DUCK_HOLD_MS = 400;
/** How fast the gain returns to 1 after the hold. */
export const DUCK_RELEASE_MS = 300;

export interface DuckState {
  /** The gain is at (or ramping to) {@link DUCK_GAIN}. */
  ducked: boolean;
  /** `now` of the last sample above the threshold, or null if none yet. */
  lastLoudAt: number | null;
}

export const INITIAL_DUCK_STATE: DuckState = { ducked: false, lastLoudAt: null };

export interface DuckInput {
  /** The mic's current level in dBFS (`-Infinity` for silence). */
  dbfs: number;
  /** A monotonic clock, in ms. */
  now: number;
  /** The mic is muted: there is no voice in the take to duck under. */
  muted: boolean;
}

export interface DuckDecision {
  state: DuckState;
  /** A gain ramp to start now, or null to leave the current one alone. */
  ramp: { target: number; ms: number } | null;
}

/** RMS of an `AnalyserNode` byte time-domain buffer (128 = silence) in dBFS. */
export function dbfsFromTimeDomain(data: Uint8Array): number {
  if (data.length === 0) return -Infinity;
  let sum = 0;
  for (const byte of data) {
    const norm = (byte - 128) / 128;
    sum += norm * norm;
  }
  const rms = Math.sqrt(sum / data.length);
  return rms === 0 ? -Infinity : 20 * Math.log10(rms);
}

/**
 * One step of the ducking loop. A voice above the threshold ducks at once (attack); once
 * the mic has been quiet for the hold time the gain is released. A muted mic counts as
 * quiet, so it never starts a duck and ends one already in progress after the hold.
 */
export function decideDuck(input: DuckInput, state: DuckState): DuckDecision {
  const talking = !input.muted && input.dbfs > DUCK_THRESHOLD_DBFS;
  if (talking) {
    const next: DuckState = { ducked: true, lastLoudAt: input.now };
    return {
      state: next,
      ramp: state.ducked ? null : { target: DUCK_GAIN, ms: DUCK_ATTACK_MS },
    };
  }
  const quietFor = state.lastLoudAt === null ? 0 : input.now - state.lastLoudAt;
  if (state.ducked && quietFor >= DUCK_HOLD_MS) {
    return {
      state: { ducked: false, lastLoudAt: state.lastLoudAt },
      ramp: { target: 1, ms: DUCK_RELEASE_MS },
    };
  }
  return { state, ramp: null };
}
