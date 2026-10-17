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
    expect(screen.getByRole("button", { name: /Start Recording/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Screen/ })).not.toBeInTheDocument();
  });

  it("switches to the Capture tab and shows the Area, Screen and Frame actions", () => {
    render(<CapturePanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Capture" }));
    for (const name of [/^Area/, /^Screen/, /^Frame/]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    // Recording controls are no longer mounted on the capture tab.
    expect(screen.queryByRole("button", { name: /Start Recording/ })).not.toBeInTheDocument();
  });

  it("asks main to open the source picker when the source card's Choose/Change is clicked", () => {
    const requestChooseSource = vi.fn();
    window.electronAPI = { ...realApi, requestChooseSource };
    render(<CapturePanel />);
    // The mocked setup has no selected source, so the source card shows "Choose".
    fireEvent.click(screen.getByRole("button", { name: "Choose" }));
    expect(requestChooseSource).toHaveBeenCalledTimes(1);
  });

  it("asks main to run the clicked mode", () => {
    const requestCaptureScreenshot = vi.fn();
    window.electronAPI = { ...realApi, requestCaptureScreenshot };
    render(<CapturePanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Capture" }));
    fireEvent.click(screen.getByRole("button", { name: /^Area/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Screen/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Frame/ }));
    expect(requestCaptureScreenshot.mock.calls).toEqual([["area"], ["screen"], ["frame"]]);
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
