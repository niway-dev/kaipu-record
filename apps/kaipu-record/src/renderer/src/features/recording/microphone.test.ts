import { describe, expect, it } from "vitest";
import { getMicrophoneType } from "./microphone";

describe("getMicrophoneType", () => {
  it("detects built-in microphones", () => {
    expect(getMicrophoneType("MacBook Pro Microphone")).toBe("micBuiltIn");
    expect(getMicrophoneType("Built-in Microphone")).toBe("micBuiltIn");
    expect(getMicrophoneType("iMac Internal Mic")).toBe("micBuiltIn");
  });

  it("detects bluetooth microphones", () => {
    expect(getMicrophoneType("AirPods Pro")).toBe("micBluetooth");
    expect(getMicrophoneType("Bluetooth Headset")).toBe("micBluetooth");
  });

  it("detects usb microphones", () => {
    expect(getMicrophoneType("Blue Yeti USB Microphone")).toBe("micUsb");
  });

  it("falls back to external for anything else", () => {
    expect(getMicrophoneType("Scarlett 2i2 Interface")).toBe("micExternal");
  });
});
