import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingSettings, RecordingTick } from "@shared/types/ipc";
import { ControlBarWindowRoot } from "./control-bar-window";

const settings: RecordingSettings = {
  selectedSource: null,
  selectedMicrophone: null,
  area: null,
  isMicrophoneEnabled: true,
  isSystemAudioEnabled: false,
  isCameraEnabled: false,
};
let receiveTick: (tick: RecordingTick) => void;
let receiveSettings: (value: RecordingSettings) => void;
const tick: RecordingTick = {
  elapsedSeconds: 10,
  levels: [],
  status: "recording",
  screenshotAvailable: true,
};

beforeEach(() => {
  window.electronAPI.getRecordingSettings = vi.fn(async () => settings);
  window.electronAPI.onRecordingSettingsChanged = vi.fn((receive) => {
    receiveSettings = receive;
    return () => {};
  });
  window.electronAPI.onControlTick = vi.fn((receive) => {
    receiveTick = receive;
    return () => {};
  });
  window.electronAPI.updateRecordingSettings = vi.fn();
  window.electronAPI.requestCaptureScreenshot = vi.fn();
});

describe("recording widget wiring", () => {
  it("uses the existing capture request and reflects the main process's availability", async () => {
    render(<ControlBarWindowRoot />);
    act(() => receiveTick(tick));
    fireEvent.click(screen.getByRole("button", { name: "Take screenshot" }));
    expect(window.electronAPI.requestCaptureScreenshot).toHaveBeenCalledExactlyOnceWith("frame");
    act(() => receiveTick({ ...tick, screenshotAvailable: false }));
    expect(screen.queryByRole("button", { name: "Take screenshot" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Mic" })).toBeEnabled());
  });

  it("toggles both directions, and stays in sync with shortcuts and other windows", async () => {
    render(<ControlBarWindowRoot />);
    act(() => receiveTick(tick));
    await waitFor(() => expect(screen.getByRole("button", { name: "Camera" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    expect(window.electronAPI.updateRecordingSettings).toHaveBeenLastCalledWith({
      isCameraEnabled: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    expect(window.electronAPI.updateRecordingSettings).toHaveBeenLastCalledWith({
      isCameraEnabled: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Mic" }));
    expect(window.electronAPI.updateRecordingSettings).toHaveBeenLastCalledWith({
      isMicrophoneEnabled: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Audio" }));
    expect(window.electronAPI.updateRecordingSettings).toHaveBeenLastCalledWith({
      isSystemAudioEnabled: true,
    });
    act(() => receiveSettings({ ...settings, isMicrophoneEnabled: false, isCameraEnabled: true }));
    expect(screen.getByRole("button", { name: "Mic" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "true");
  });
});
