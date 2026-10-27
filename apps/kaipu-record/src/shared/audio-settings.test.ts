import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUDIO_SETTINGS,
  clampMicLevel,
  clampSystemAudioVolume,
  sanitizeAudioSettings,
} from "./audio-settings";

describe("DEFAULT_AUDIO_SETTINGS", () => {
  it("reproduces today's recording: unity mic, noise suppression on, full system audio, no ducking", () => {
    expect(DEFAULT_AUDIO_SETTINGS).toEqual({
      micLevel: 100,
      noiseSuppression: true,
      systemAudioVolume: 100,
      duckSystemAudioWhileTalking: false,
    });
  });
});

describe("clampMicLevel", () => {
  it("holds the level in 0–200 and rounds it", () => {
    expect(clampMicLevel(-5)).toBe(0);
    expect(clampMicLevel(500)).toBe(200);
    expect(clampMicLevel(70.4)).toBe(70);
    expect(clampMicLevel(Number.NaN)).toBe(100);
  });
});

describe("clampSystemAudioVolume", () => {
  it("holds the volume in 0–100 and rounds it", () => {
    expect(clampSystemAudioVolume(-1)).toBe(0);
    expect(clampSystemAudioVolume(150)).toBe(100);
    expect(clampSystemAudioVolume(33.6)).toBe(34);
    expect(clampSystemAudioVolume(Number.POSITIVE_INFINITY)).toBe(100);
  });
});

describe("sanitizeAudioSettings", () => {
  it("returns the defaults for anything that is not an object", () => {
    expect(sanitizeAudioSettings(undefined)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(sanitizeAudioSettings("loud")).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(sanitizeAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it("keeps a valid stored value", () => {
    const audio = {
      micLevel: 150,
      noiseSuppression: false,
      systemAudioVolume: 40,
      duckSystemAudioWhileTalking: true,
    };
    expect(sanitizeAudioSettings(audio)).toEqual(audio);
  });

  it("falls back field by field and clamps numbers instead of dropping them", () => {
    expect(
      sanitizeAudioSettings({
        micLevel: 9000,
        noiseSuppression: "yes",
        systemAudioVolume: "loud",
        duckSystemAudioWhileTalking: 1,
      }),
    ).toEqual({
      micLevel: 200,
      noiseSuppression: true,
      systemAudioVolume: 100,
      duckSystemAudioWhileTalking: false,
    });
    expect(sanitizeAudioSettings({ micLevel: 0 }).micLevel).toBe(0);
  });
});
