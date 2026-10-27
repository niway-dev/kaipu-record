import { describe, expect, it } from "vitest";
import {
  DUCK_ATTACK_MS,
  DUCK_GAIN,
  DUCK_HOLD_MS,
  DUCK_RELEASE_MS,
  DUCK_THRESHOLD_DBFS,
  INITIAL_DUCK_STATE,
  dbfsFromTimeDomain,
  decideDuck,
} from "./ducking";

const LOUD = DUCK_THRESHOLD_DBFS + 10;
const QUIET = DUCK_THRESHOLD_DBFS - 10;

describe("ducking constants", () => {
  it("match the design: -40 dBFS, 80 ms attack to 0.3, 400 ms hold, 300 ms release", () => {
    expect(DUCK_THRESHOLD_DBFS).toBe(-40);
    expect(DUCK_ATTACK_MS).toBe(80);
    expect(DUCK_GAIN).toBe(0.3);
    expect(DUCK_HOLD_MS).toBe(400);
    expect(DUCK_RELEASE_MS).toBe(300);
  });
});

describe("dbfsFromTimeDomain", () => {
  it("is -Infinity for silence (every byte at the 128 midpoint)", () => {
    expect(dbfsFromTimeDomain(new Uint8Array(64).fill(128))).toBe(-Infinity);
  });

  it("is 0 dBFS for a full-scale square wave", () => {
    const data = new Uint8Array(64).map((_, i) => (i % 2 ? 0 : 256 - 1));
    expect(dbfsFromTimeDomain(data)).toBeCloseTo(0, 0);
  });

  it("reads a half-scale signal as about -6 dBFS", () => {
    const data = new Uint8Array(64).map((_, i) => (i % 2 ? 64 : 192));
    expect(dbfsFromTimeDomain(data)).toBeCloseTo(-6.02, 1);
  });
});

describe("decideDuck", () => {
  it("does nothing while the mic stays quiet", () => {
    const d = decideDuck({ dbfs: QUIET, now: 1000, muted: false }, INITIAL_DUCK_STATE);
    expect(d.ramp).toBeNull();
    expect(d.state.ducked).toBe(false);
  });

  it("ducks to 0.3 over the attack time when the voice crosses the threshold", () => {
    const d = decideDuck({ dbfs: LOUD, now: 1000, muted: false }, INITIAL_DUCK_STATE);
    expect(d.ramp).toEqual({ target: DUCK_GAIN, ms: DUCK_ATTACK_MS });
    expect(d.state).toEqual({ ducked: true, lastLoudAt: 1000 });
  });

  it("does not re-ramp while the voice continues, but keeps the hold timer fresh", () => {
    const first = decideDuck({ dbfs: LOUD, now: 1000, muted: false }, INITIAL_DUCK_STATE);
    const d = decideDuck({ dbfs: LOUD, now: 1050, muted: false }, first.state);
    expect(d.ramp).toBeNull();
    expect(d.state).toEqual({ ducked: true, lastLoudAt: 1050 });
  });

  it("holds the duck through a short pause", () => {
    const ducked = { ducked: true, lastLoudAt: 1000 };
    const d = decideDuck({ dbfs: QUIET, now: 1000 + DUCK_HOLD_MS - 1, muted: false }, ducked);
    expect(d.ramp).toBeNull();
    expect(d.state.ducked).toBe(true);
  });

  it("releases back to 1 over the release time after the hold", () => {
    const ducked = { ducked: true, lastLoudAt: 1000 };
    const d = decideDuck({ dbfs: QUIET, now: 1000 + DUCK_HOLD_MS, muted: false }, ducked);
    expect(d.ramp).toEqual({ target: 1, ms: DUCK_RELEASE_MS });
    expect(d.state.ducked).toBe(false);
  });

  it("ducks again after a release when the voice returns", () => {
    const released = { ducked: false, lastLoudAt: 1000 };
    const d = decideDuck({ dbfs: LOUD, now: 2000, muted: false }, released);
    expect(d.ramp).toEqual({ target: DUCK_GAIN, ms: DUCK_ATTACK_MS });
  });

  it("never ducks for a muted mic, however loud", () => {
    const d = decideDuck({ dbfs: LOUD, now: 1000, muted: true }, INITIAL_DUCK_STATE);
    expect(d.ramp).toBeNull();
    expect(d.state.ducked).toBe(false);
  });

  it("releases a duck when the mic is muted mid-duck, after the hold", () => {
    const ducked = { ducked: true, lastLoudAt: 1000 };
    expect(decideDuck({ dbfs: LOUD, now: 1100, muted: true }, ducked).ramp).toBeNull();
    const d = decideDuck({ dbfs: LOUD, now: 1000 + DUCK_HOLD_MS, muted: true }, ducked);
    expect(d.ramp).toEqual({ target: 1, ms: DUCK_RELEASE_MS });
  });
});
