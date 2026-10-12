import { describe, expect, it } from "vitest";
import {
  finiteNumber,
  isPermissionKind,
  isTrayMode,
  isWindowPresetName,
  sanitizeRecordingSettingsPatch,
} from "./ipc-args";

describe("ipc argument validators", () => {
  it("accepts only known permission kinds", () => {
    expect(isPermissionKind("screen")).toBe(true);
    expect(isPermissionKind("x-apple.systempreferences:evil")).toBe(false);
    expect(isPermissionKind(undefined)).toBe(false);
  });

  it("accepts only real window presets (no prototype keys)", () => {
    expect(isWindowPresetName("main")).toBe(true);
    expect(isWindowPresetName("__proto__")).toBe(false);
    expect(isWindowPresetName("constructor")).toBe(false);
    expect(isWindowPresetName(3)).toBe(false);
  });

  it("validates tray mode and numbers", () => {
    expect(isTrayMode("record")).toBe(true);
    expect(isTrayMode("nope")).toBe(false);
    expect(finiteNumber(5)).toBe(5);
    expect(finiteNumber(NaN)).toBeNull();
    expect(finiteNumber("5")).toBeNull();
    expect(finiteNumber(Infinity)).toBeNull();
  });

  it("keeps only known recording-setting fields with the right types", () => {
    const patch = sanitizeRecordingSettingsPatch({
      isCameraEnabled: true,
      isMicrophoneEnabled: "yes",
      polluted: 1,
      selectedSource: { id: "screen:1:0", name: "Screen 1", type: "screen" },
      selectedMicrophone: { deviceId: 5, label: "x" },
    });
    expect(patch).toEqual({
      isCameraEnabled: true,
      selectedSource: { id: "screen:1:0", name: "Screen 1", type: "screen" },
    });
    expect(sanitizeRecordingSettingsPatch(null)).toEqual({});
    expect(sanitizeRecordingSettingsPatch({ selectedSource: null })).toEqual({
      selectedSource: null,
    });
  });
});
