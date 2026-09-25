import { describe, expect, it } from "vitest";
import {
  UPDATE_FOCUS_THROTTLE_MS,
  canStartCheck,
  nextUpdateStatus,
  shouldCheckOnFocus,
} from "./updater-state";
import type { UpdateStatus } from "./types";

const AT = 1_700_000_000_000;

describe("nextUpdateStatus", () => {
  it("a started check moves to `checking` from rest", () => {
    expect(nextUpdateStatus({ state: "idle" }, { type: "check-started" })).toEqual({
      state: "checking",
    });
  });

  it("an empty check records when it happened", () => {
    const s = nextUpdateStatus({ state: "checking" }, { type: "not-available", at: AT });
    expect(s).toEqual({ state: "up-to-date", checkedAt: AT });
  });

  it("an available update carries its version and the check time", () => {
    const s = nextUpdateStatus(
      { state: "checking" },
      { type: "available", version: "0.9.0", at: AT },
    );
    expect(s).toEqual({ state: "available", version: "0.9.0", checkedAt: AT });
  });

  it("progress advances a download", () => {
    const s = nextUpdateStatus(
      { state: "available", version: "0.9.0", checkedAt: AT },
      { type: "progress", version: "0.9.0", percent: 43 },
    );
    expect(s).toEqual({ state: "downloading", version: "0.9.0", percent: 43 });
  });

  it("a failed check records the reason and when it failed", () => {
    const s = nextUpdateStatus(
      { state: "checking" },
      { type: "error", message: "net::ERR_INTERNET_DISCONNECTED", at: AT },
    );
    expect(s).toEqual({
      state: "error",
      message: "net::ERR_INTERNET_DISCONNECTED",
      checkedAt: AT,
    });
  });

  // The three rules that carry the weight.

  describe("a downloaded build outranks everything", () => {
    const ready: UpdateStatus = { state: "ready", version: "0.9.0" };

    it("survives a later check that finds nothing", () => {
      expect(nextUpdateStatus(ready, { type: "not-available", at: AT })).toEqual(ready);
    });

    it("survives a later error", () => {
      expect(nextUpdateStatus(ready, { type: "error", message: "offline", at: AT })).toEqual(ready);
    });

    it("survives a check being started", () => {
      expect(nextUpdateStatus(ready, { type: "check-started" })).toEqual(ready);
    });
  });

  describe("progress only advances a real download", () => {
    it("is ignored at rest, rather than inventing a download", () => {
      expect(
        nextUpdateStatus({ state: "idle" }, { type: "progress", version: "0.9.0", percent: 10 }),
      ).toEqual({ state: "idle" });
    });

    it("is ignored once the build is ready", () => {
      const ready: UpdateStatus = { state: "ready", version: "0.9.0" };
      expect(nextUpdateStatus(ready, { type: "progress", version: "0.9.0", percent: 99 })).toEqual(
        ready,
      );
    });

    it("clamps a percent outside 0..100", () => {
      const from: UpdateStatus = { state: "downloading", version: "0.9.0", percent: 50 };
      expect(nextUpdateStatus(from, { type: "progress", version: "0.9.0", percent: 140 })).toEqual({
        state: "downloading",
        version: "0.9.0",
        percent: 100,
      });
    });
  });

  it("a download that fails surfaces the error", () => {
    const s = nextUpdateStatus(
      { state: "downloading", version: "0.9.0", percent: 12 },
      { type: "error", message: "ENOSPC", at: AT },
    );
    expect(s).toEqual({ state: "error", message: "ENOSPC", checkedAt: AT });
  });

  it("a finished download is ready whatever came before", () => {
    const s = nextUpdateStatus(
      { state: "downloading", version: "0.9.0", percent: 99 },
      { type: "downloaded", version: "0.9.0" },
    );
    expect(s).toEqual({ state: "ready", version: "0.9.0" });
  });
});

describe("canStartCheck", () => {
  it("allows a check at rest", () => {
    expect(canStartCheck({ state: "idle" })).toBe(true);
    expect(canStartCheck({ state: "up-to-date", checkedAt: AT })).toBe(true);
    expect(canStartCheck({ state: "error", message: "offline", checkedAt: AT })).toBe(true);
  });

  // electron-updater is not re-entrant while a download runs, and the manual
  // button makes a second call reachable for the first time.
  it("refuses while a check or a download is already running", () => {
    expect(canStartCheck({ state: "checking" })).toBe(false);
    expect(canStartCheck({ state: "downloading", version: "0.9.0", percent: 5 })).toBe(false);
  });

  it("refuses once a build is ready — there is nothing left to look for", () => {
    expect(canStartCheck({ state: "ready", version: "0.9.0" })).toBe(false);
  });
});

describe("shouldCheckOnFocus", () => {
  it("checks when the app has never checked", () => {
    expect(shouldCheckOnFocus(null, AT)).toBe(true);
  });

  it("refuses inside the throttle window", () => {
    expect(shouldCheckOnFocus(AT, AT + UPDATE_FOCUS_THROTTLE_MS - 1)).toBe(false);
  });

  it("allows once the window has passed", () => {
    expect(shouldCheckOnFocus(AT, AT + UPDATE_FOCUS_THROTTLE_MS)).toBe(true);
  });

  // A clock that jumps backwards (sleep, timezone, NTP) must not lock checking out.
  it("allows when the clock moved backwards", () => {
    expect(shouldCheckOnFocus(AT, AT - 60_000)).toBe(true);
  });
});
