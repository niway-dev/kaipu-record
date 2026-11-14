import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Isolate the panel from the recording internals: useRecordingSetup pulls in
// useMicrophones (navigator.mediaDevices — absent in jsdom). The panel only reads the three
// on/off flags and calls the toggles. Activity stays real so it reads the electronAPI stub
// (which the busy tests override).
const { setupState, toggleMicrophone, toggleSystemAudio, toggleCamera } = vi.hoisted(() => ({
  setupState: { mic: true, audio: false, camera: false },
  toggleMicrophone: vi.fn(),
  toggleSystemAudio: vi.fn(),
  toggleCamera: vi.fn(),
}));
vi.mock("@renderer/features/recording/hooks/use-recording-setup", () => ({
  useRecordingSetup: () => ({
    selectedSource: null,
    isMicrophoneEnabled: setupState.mic,
    isSystemAudioEnabled: setupState.audio,
    isCameraEnabled: setupState.camera,
    toggleMicrophone,
    toggleSystemAudio,
    toggleCamera,
  }),
}));
vi.mock("@renderer/features/shortcuts/use-shortcut-labels", () => ({
  useShortcutLabels: () => ({
    startRecording: "⇧⌘2",
    bringToFront: "⌃⌘O",
    captureScreenshot: "⇧⌘1",
    captureWindow: "⌃⌘W",
    captureInstant: "⌃⌘X",
  }),
}));

import { CapturePanel } from "./capture-panel";

// Snapshot the stubbed API so per-test overrides can be restored.
const realApi = window.electronAPI;
beforeEach(() => {
  setupState.mic = true;
  setupState.audio = false;
  setupState.camera = false;
  toggleMicrophone.mockClear();
  toggleSystemAudio.mockClear();
  toggleCamera.mockClear();
});
afterEach(() => {
  window.electronAPI = realApi;
});

/** The panel while a take is in progress: the recording runs in another window. */
function recordingApi(activity: Record<string, unknown>): void {
  window.electronAPI = {
    ...realApi,
    getRecordingState: async () =>
      ({ active: true, status: "recording", elapsedSeconds: 42, ...activity }) as never,
  };
}

describe("CapturePanel, idle", () => {
  it("has no tabs, source card or drawers", () => {
    render(<CapturePanel />);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /settings$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start recording/ })).not.toBeInTheDocument();
  });

  it("opens the main window from the header's Open", () => {
    const openMainWindow = vi.fn();
    window.electronAPI = { ...realApi, openMainWindow };
    render(<CapturePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open ↗" }));
    expect(openMainWindow).toHaveBeenCalledTimes(1);
  });

  it("shows the Screenshot and Recording rows and the Instant line", () => {
    render(<CapturePanel />);
    expect(screen.getByRole("button", { name: /^Screenshot/ })).toHaveTextContent("⇧⌘1");
    expect(screen.getByRole("button", { name: /^Recording/ })).toHaveTextContent("⇧⌘2");
    expect(screen.getByText("Instant, whole screen")).toBeInTheDocument();
  });

  it("the Screenshot row leaves the mode to main, even before settings load", () => {
    const requestCaptureScreenshot = vi.fn();
    // Settings never arrive: a mode chosen here could only be the default. Main resolves the
    // stored mode itself (the ⌘⇧1 path), so the row sends none.
    const getSettings = vi.fn(() => new Promise<never>(() => {}));
    window.electronAPI = { ...realApi, requestCaptureScreenshot, getSettings };
    render(<CapturePanel />);
    fireEvent.click(screen.getByRole("button", { name: /^Screenshot/ }));
    expect(requestCaptureScreenshot.mock.calls).toEqual([[]]);
  });

  it("the Recording row opens the record selector in the last used mode", () => {
    const requestRecordSelector = vi.fn();
    const requestStartRecording = vi.fn();
    window.electronAPI = { ...realApi, requestRecordSelector, requestStartRecording };
    render(<CapturePanel />);
    fireEvent.click(screen.getByRole("button", { name: /^Recording/ }));
    expect(requestRecordSelector.mock.calls).toEqual([[]]);
    // Nothing starts a take straight from the tray.
    expect(requestStartRecording).not.toHaveBeenCalled();
  });

  it("shows Mic, Audio and Camera as switches with their ON or OFF state", () => {
    render(<CapturePanel />);
    expect(screen.getByText("Record with")).toBeInTheDocument();
    const mic = screen.getByRole("button", { name: /Mic/ });
    const audio = screen.getByRole("button", { name: /Audio/ });
    const camera = screen.getByRole("button", { name: /Camera/ });
    expect(mic).toHaveAttribute("aria-pressed", "true");
    expect(mic).toHaveTextContent("ON");
    expect(audio).toHaveAttribute("aria-pressed", "false");
    expect(audio).toHaveTextContent("OFF");
    expect(camera).toHaveAttribute("aria-pressed", "false");
    expect(camera).toHaveTextContent("OFF");
  });

  it("each switch toggles the shared setup, and only its own", () => {
    render(<CapturePanel />);
    fireEvent.click(screen.getByRole("button", { name: /Mic/ }));
    expect(toggleMicrophone).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Audio/ }));
    expect(toggleSystemAudio).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Camera/ }));
    expect(toggleCamera).toHaveBeenCalledTimes(1);
    expect(toggleMicrophone).toHaveBeenCalledTimes(1);
  });

  it("footer: names the active workspace and shows the main window from it", async () => {
    const openMainWindow = vi.fn();
    window.electronAPI = { ...realApi, openMainWindow };
    render(<CapturePanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Default workspace/ }));
    expect(openMainWindow).toHaveBeenCalledTimes(1);
  });

  it("footer: Setup opens the Capture page in the main window", () => {
    const openCaptureSetup = vi.fn();
    const openMainWindow = vi.fn();
    window.electronAPI = { ...realApi, openCaptureSetup, openMainWindow };
    render(<CapturePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Setup" }));
    expect(openCaptureSetup).toHaveBeenCalledTimes(1);
    expect(openMainWindow).not.toHaveBeenCalled();
  });

  it("keeps the root test id the height E2E measures", () => {
    render(<CapturePanel />);
    expect(screen.getByTestId("capture-panel")).toBeInTheDocument();
  });
});

describe("CapturePanel, busy", () => {
  it("shows the elapsed time, the mode and Stop with its shortcut instead of the entries", async () => {
    recordingApi({ elapsedSeconds: 65 });
    render(<CapturePanel />);
    expect(await screen.findByText("00:01:05")).toBeInTheDocument();
    expect(screen.getByText("Recording · Screen")).toBeInTheDocument();
    const stop = screen.getByRole("button", { name: /^Stop/ });
    expect(stop).toHaveTextContent("⇧⌘2");
    expect(screen.queryByRole("button", { name: /^Screenshot/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Recording/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Instant, whole screen")).not.toBeInTheDocument();
  });

  it("keeps the ticking clock out of the status live region, in its own timer", async () => {
    recordingApi({ elapsedSeconds: 65 });
    render(<CapturePanel />);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Recording · Screen");
    expect(status).not.toHaveTextContent("00:01:05");
    expect(screen.getByRole("timer")).toHaveTextContent("00:01:05");
  });

  it("Stop sends the stop command to the recording window", async () => {
    const controlCommand = vi.fn();
    window.electronAPI = {
      ...realApi,
      controlCommand,
      getRecordingState: async () => ({ active: true, status: "recording", elapsedSeconds: 3 }),
    };
    render(<CapturePanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^Stop/ }));
    expect(controlCommand.mock.calls).toEqual([["stop"]]);
  });

  it("shows the switches read-only, off ones dimmed, with the note", async () => {
    recordingApi({});
    render(<CapturePanel />);
    await screen.findByText("Recording with");
    for (const name of [/Mic/, /Audio/, /Camera/]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: /Mic/ })).not.toHaveAttribute("data-dim");
    expect(screen.getByRole("button", { name: /Audio/ })).toHaveAttribute("data-dim");
    expect(screen.getByText("Finish the recording to change these.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Audio/ }));
    expect(toggleSystemAudio).not.toHaveBeenCalled();
    expect(screen.queryByText("Record with")).not.toBeInTheDocument();
  });

  it("a paused take says Paused", async () => {
    recordingApi({ status: "paused", elapsedSeconds: 9 });
    render(<CapturePanel />);
    expect(await screen.findByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("00:00:09")).toBeInTheDocument();
    expect(screen.queryByText(/Recording ·/)).not.toBeInTheDocument();
  });

  it("a pending take (countdown) is busy: Starting…, no entries, Stop cancels it", async () => {
    const requestRecordSelector = vi.fn();
    const controlCommand = vi.fn();
    window.electronAPI = {
      ...realApi,
      requestRecordSelector,
      controlCommand,
      getRecordingState: async () => ({
        active: false,
        status: "recording" as const,
        elapsedSeconds: 0,
        pending: true,
      }),
    };
    render(<CapturePanel />);
    expect(await screen.findByText("Starting…")).toBeInTheDocument();
    expect(screen.queryByText(/Recording ·/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Screenshot/ })).not.toBeInTheDocument();
    expect(screen.getByText("Finish the recording to change these.")).toBeInTheDocument();
    expect(requestRecordSelector).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Stop/ }));
    expect(controlCommand.mock.calls).toEqual([["stop"]]);
  });

  it("keeps the footer: Setup stays reachable mid-take", async () => {
    recordingApi({});
    render(<CapturePanel />);
    expect(await screen.findByRole("button", { name: "Setup" })).toBeInTheDocument();
  });
});
