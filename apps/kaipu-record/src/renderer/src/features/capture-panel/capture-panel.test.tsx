import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Isolate the panel from the recording internals: useRecordingSetup pulls in
// useMicrophones (navigator.mediaDevices — absent in jsdom). We only need a static
// setup shape for the dumb controls. Activity stays real so it reads the electronAPI
// stub (which the lock test overrides).
vi.mock("@renderer/features/recording/hooks/use-recording-setup", () => ({
  useRecordingSetup: () => ({
    selectedSource: null,
    isMicrophoneEnabled: false,
    isSystemAudioEnabled: false,
    isCameraEnabled: false,
    toggleMicrophone: vi.fn(),
    toggleSystemAudio: vi.fn(),
    toggleCamera: vi.fn(),
    microphones: [],
    selectedMicrophone: null,
    isMicrophoneMenuOpen: false,
    toggleMicrophoneMenu: vi.fn(),
    selectMicrophone: vi.fn(),
  }),
}));
vi.mock("@renderer/features/recording/hooks/use-source-selection", () => ({
  useSourceSelection: () => {},
}));

import { CapturePanel } from "./capture-panel";

// Snapshot the stubbed API so per-test overrides can be restored.
const realApi = window.electronAPI;
afterEach(() => {
  window.electronAPI = realApi;
});

describe("CapturePanel — tabs", () => {
  it("defaults to the Record tab (recording controls, not the capture buttons)", () => {
    render(<CapturePanel />);
    expect(screen.getByRole("tab", { name: "Record" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /Start recording/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Capture/ })).not.toBeInTheDocument();
  });

  it("switches to the Capture tab and shows the Frame and Screen actions, and no Window (it is off)", () => {
    render(<CapturePanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Capture" }));
    for (const name of [/^Frame/, /^Screen/]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /^Window/ })).not.toBeInTheDocument();
    // Recording controls are no longer mounted on the capture tab.
    expect(screen.queryByRole("button", { name: /Start recording/ })).not.toBeInTheDocument();
  });

  it("Start opens the selector in the last used mode; a mode chip opens it in its own", async () => {
    const requestRecordSelector = vi.fn();
    const requestStartRecording = vi.fn();
    const settings = await realApi.getSettings();
    window.electronAPI = {
      ...realApi,
      requestRecordSelector,
      requestStartRecording,
      getSettings: async () => ({
        ...settings,
        recordingMode: "frame",
        recordingArea: { "1": { x: 0, y: 0, width: 1280, height: 720, ratio: "16:9" } },
      }),
    };
    render(<CapturePanel />);
    await screen.findByText("Last used: Frame · 16:9. Switch inside the selector.");
    // Frame, Window and Screen: Window opens the thumbnail picker while its overlay is off.
    for (const name of [/^Frame/, /^Window/, /^Screen/]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /^Frame/ })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /Start recording/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Window/ }));
    expect(requestRecordSelector.mock.calls).toEqual([[undefined], ["window"]]);
    // Nothing starts a take straight from the tray any more.
    expect(requestStartRecording).not.toHaveBeenCalled();
  });

  it("shows Mic, Audio and Camera under the mode chips", () => {
    render(<CapturePanel />);
    expect(screen.getAllByText("OFF")).toHaveLength(3);
  });

  it("splits the Camera tile in the idle layout and opens the inline drawer, growing the panel", async () => {
    const { container } = render(<CapturePanel />);
    const chevron = screen.getByRole("button", { name: "Camera settings" });
    expect(screen.queryByRole("region", { name: "Camera settings" })).not.toBeInTheDocument();
    fireEvent.click(chevron);
    const drawer = screen.getByRole("region", { name: "Camera settings" });
    // The drawer sits inside the root the ResizeObserver measures, so the window follows it.
    expect(container.firstElementChild?.contains(drawer)).toBe(true);
  });

  it("captures in the chosen mode when a chip is clicked, without touching the stored mode", async () => {
    const requestCaptureScreenshot = vi.fn();
    const updateSettings = vi.fn();
    window.electronAPI = { ...realApi, requestCaptureScreenshot, updateSettings };
    render(<CapturePanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Capture" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Screen/ }));
    expect(requestCaptureScreenshot.mock.calls).toEqual([["screen"]]);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("captures with the remembered mode from the Capture tab's primary button", async () => {
    const requestCaptureScreenshot = vi.fn();
    const settings = await realApi.getSettings();
    window.electronAPI = {
      ...realApi,
      requestCaptureScreenshot,
      getSettings: async () => ({ ...settings, screenshotMode: "screen" }),
    };
    render(<CapturePanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Capture" }));
    await screen.findByText("Last used: Screen. Switch inside the selector.");
    fireEvent.click(screen.getByRole("button", { name: /^Capture/ }));
    expect(requestCaptureScreenshot.mock.calls).toEqual([["screen"]]);
  });

  it("locks the tabs to Record while a recording is in progress", async () => {
    window.electronAPI = {
      ...realApi,
      getRecordingState: async () => ({ active: true, status: "recording", elapsedSeconds: 5 }),
    };
    render(<CapturePanel />);
    // Once the activity resolves, both tabs are disabled (can't switch mid-recording).
    await waitFor(() => expect(screen.getByRole("tab", { name: "Capture" })).toBeDisabled());
    expect(screen.getByRole("tab", { name: "Record" })).toBeDisabled();
    // Clicking the locked Capture tab does not reveal the capture action.
    fireEvent.click(screen.getByRole("tab", { name: "Capture" }));
    expect(screen.queryByRole("button", { name: /^Screen/ })).not.toBeInTheDocument();
  });

  it("treats a pending take (countdown) as busy: no Start, no chips, tabs locked", async () => {
    const requestRecordSelector = vi.fn();
    window.electronAPI = {
      ...realApi,
      requestRecordSelector,
      getRecordingState: async () => ({
        active: false,
        status: "recording" as const,
        elapsedSeconds: 0,
        pending: true,
      }),
    };
    render(<CapturePanel />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Capture" })).toBeDisabled());
    expect(screen.queryByRole("button", { name: /Start recording/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Frame/ })).not.toBeInTheDocument();
    // No "Recording · 0:00" banner: nothing records yet.
    expect(screen.queryByText(/Recording ·/)).not.toBeInTheDocument();
    expect(requestRecordSelector).not.toHaveBeenCalled();
  });

  it("keeps the three toggles live mid-take while the source card stays locked", async () => {
    window.electronAPI = {
      ...realApi,
      getRecordingState: async () => ({
        active: true,
        status: "recording",
        elapsedSeconds: 5,
        systemAudioAvailable: false,
      }),
    };
    const { container } = render(<CapturePanel />);
    await waitFor(() => expect(container.querySelector("[inert]")).not.toBeNull());

    const toggles = screen.getAllByText("OFF").map((el) => el.closest("button")!);
    expect(toggles).toHaveLength(3);
    for (const toggle of toggles) expect(toggle.closest("[inert]")).toBeNull();
    // No loopback in this take → the system-audio tile (second) is disabled.
    expect(toggles[0]).toBeEnabled();
    expect(toggles[1]).toBeDisabled();
    expect(toggles[2]).toBeEnabled();
    // The source card sits in the locked (inert) wrapper.
    const locked = container.querySelectorAll("[inert]");
    expect(locked).toHaveLength(1);
    expect(locked[0].querySelector("button")).not.toBeNull();
  });
});
