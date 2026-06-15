import { describe, expect, it } from "vitest";
import { getMicrophoneType } from "./microphone";

describe("getMicrophoneType", () => {
  it("detects built-in microphones", () => {
    expect(getMicrophoneType("MacBook Pro Microphone")).toBe("BUILT-IN");
    expect(getMicrophoneType("Built-in Microphone")).toBe("BUILT-IN");
    expect(getMicrophoneType("iMac Internal Mic")).toBe("BUILT-IN");
  });

  it("detects bluetooth microphones", () => {
    expect(getMicrophoneType("AirPods Pro")).toBe("BLUETOOTH");
    expect(getMicrophoneType("Bluetooth Headset")).toBe("BLUETOOTH");
  });

  it("detects usb microphones", () => {
    expect(getMicrophoneType("Blue Yeti USB Microphone")).toBe("USB");
  });

  it("falls back to external for anything else", () => {
    expect(getMicrophoneType("Scarlett 2i2 Interface")).toBe("EXTERNAL");
  });
});
