import { describe, expect, it } from "vitest";
import type { RecordingActivity, RecordingTick } from "@shared/types/ipc";
import { IDLE_ACTIVITY, applyTick, startedActivity, stoppedActivity } from "./recording-activity";

const tick = (status: RecordingTick["status"], elapsedSeconds: number): RecordingTick => ({
  status,
  elapsedSeconds,
  levels: [],
});

describe("recording-activity", () => {
  it("starts active at zero, recording", () => {
    expect(startedActivity()).toEqual({ active: true, status: "recording", elapsedSeconds: 0 });
  });

  it("stops by going inactive, keeping the last status/elapsed", () => {
    const running: RecordingActivity = { active: true, status: "paused", elapsedSeconds: 12 };
    expect(stoppedActivity(running)).toEqual({
      active: false,
      status: "paused",
      elapsedSeconds: 12,
    });
  });

  describe("applyTick", () => {
    const running: RecordingActivity = { active: true, status: "recording", elapsedSeconds: 5 };

    it("ignores ticks while inactive", () => {
      expect(applyTick(IDLE_ACTIVITY, tick("recording", 9))).toEqual({
        activity: IDLE_ACTIVITY,
        changed: false,
      });
    });

    it("re-broadcasts when the status flips", () => {
      const result = applyTick(running, tick("paused", 5));
      expect(result.changed).toBe(true);
      expect(result.activity).toEqual({ active: true, status: "paused", elapsedSeconds: 5 });
    });

    it("re-broadcasts when the whole-second timer advances", () => {
      const result = applyTick(running, tick("recording", 6));
      expect(result.changed).toBe(true);
      expect(result.activity.elapsedSeconds).toBe(6);
    });

    it("is a no-op on a same-second tick (the key rule — no 10/s spam)", () => {
      const result = applyTick(running, tick("recording", 5));
      expect(result).toEqual({ activity: running, changed: false });
      expect(result.activity).toBe(running); // same reference, untouched
    });

    it("re-broadcasts once when loopback availability becomes known, then stays quiet", () => {
      const first = applyTick(running, { ...tick("recording", 5), systemAudioAvailable: false });
      expect(first.changed).toBe(true);
      expect(first.activity.systemAudioAvailable).toBe(false);

      const again = applyTick(first.activity, {
        ...tick("recording", 5),
        systemAudioAvailable: false,
      });
      expect(again.changed).toBe(false);
    });

    it("keeps the known availability when a tick omits it", () => {
      const known = { ...running, systemAudioAvailable: true };
      const result = applyTick(known, tick("recording", 6));
      expect(result.activity.systemAudioAvailable).toBe(true);
    });

    it("a new take starts with availability unknown", () => {
      expect(startedActivity().systemAudioAvailable).toBeUndefined();
    });
  });
});
