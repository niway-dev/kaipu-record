import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router-dom";
import type { RecorderStatus } from "@renderer/features/recording/recorder-store";
import type { RecordingSetup } from "@renderer/features/recording/hooks/use-recording-setup";
import { RecordPage } from "./record-page";

// The record page is composition over hooks; mock them so we can drive the
// auto-start / open-picker effects (finding 15 — the subtlest logic in the app,
// previously untested).
const { startRecording, openSourcePicker } = vi.hoisted(() => ({
  startRecording: vi.fn(),
  openSourcePicker: vi.fn(),
}));

const SCREEN = { id: "s1", name: "Display 1", type: "screen" as const };
const WINDOW = { id: "w1", name: "Safari", type: "window" as const };

/** Mutable setup state each test tweaks before rendering. */
let setupState: {
  selectedSource: typeof SCREEN | typeof WINDOW | null;
  isRecording: boolean;
  isSourcePickerOpen?: boolean;
  sources?: (typeof SCREEN | typeof WINDOW)[];
  microphoneEnabled?: boolean;
  microphoneGranted?: boolean;
  microphones?: { deviceId: string; label: string }[];
  recordingStatus?: RecorderStatus;
  cameraEnabled?: boolean;
};

function makeSetup(): RecordingSetup {
  return {
    selectedSource: setupState.selectedSource,
    selectSource: vi.fn(),
    isSourcePickerOpen: setupState.isSourcePickerOpen ?? false,
    openSourcePicker,
    closeSourcePicker: vi.fn(),
    isMicrophoneEnabled: setupState.microphoneEnabled ?? false,
    isSystemAudioEnabled: false,
    isCameraEnabled: setupState.cameraEnabled ?? false,
    toggleMicrophone: vi.fn(),
    toggleSystemAudio: vi.fn(),
    toggleCamera: vi.fn(),
    microphones: setupState.microphones ?? [],
    selectedMicrophone: null,
    selectMicrophone: vi.fn(),
    isRecording: setupState.isRecording,
    recordingStatus: setupState.recordingStatus ?? (setupState.isRecording ? "recording" : "idle"),
    countdown: null,
    canStartRecording: setupState.selectedSource !== null && !setupState.isRecording,
    startRecording,
    stopRecording: vi.fn(),
    toggleRecording: vi.fn(),
    pauseRecording: vi.fn(),
    resumeRecording: vi.fn(),
  };
}

vi.mock("@renderer/features/recording/hooks/use-recording-setup", () => ({
  useRecordingSetup: () => makeSetup(),
}));
vi.mock("@renderer/features/shortcuts/use-shortcut-labels", () => ({
  useShortcutLabels: () => null,
}));
vi.mock("@renderer/features/recording/hooks/use-recording-activity", () => ({
  useRecordingActivity: () => ({ active: false, status: "recording", elapsedSeconds: 0 }),
}));
vi.mock("@renderer/features/recording/hooks/use-source-selection", () => ({
  useSourceSelection: () => ({
    sources: (setupState.sources ?? []).map((source) => ({ ...source, thumbnail: "" })),
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@renderer/features/permissions", () => ({
  usePermissions: () => ({
    status: { screen: true, microphone: setupState.microphoneGranted ?? true, camera: true },
    check: vi.fn(async () => {}),
    openSettings: vi.fn(),
  }),
}));

let navigateTo: ((state: Record<string, unknown>) => void) | null = null;

/** Exposes the router's navigate so a test can arrive with a new nav state, as AppRoot does. */
function NavProbe(): null {
  const navigate = useNavigate();
  navigateTo = (state) => navigate("/", { state });
  return null;
}

function renderAt(state: Record<string, unknown> | undefined): { rerender: () => void } {
  // A fresh element on every render: React skips a rerender of the identical element.
  const ui = (): React.JSX.Element => (
    <MemoryRouter initialEntries={[{ pathname: "/", state }]}>
      <NavProbe />
      <RecordPage />
    </MemoryRouter>
  );
  const view = render(ui());
  return { rerender: () => view.rerender(ui()) };
}

describe("RecordPage auto-start", () => {
  beforeEach(() => {
    setupState = { selectedSource: SCREEN, isRecording: false };
    startRecording.mockClear();
    openSourcePicker.mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it("auto-starts exactly once for a startAt flag, even across re-renders", () => {
    const { rerender } = renderAt({ startAt: 100 });
    expect(startRecording).toHaveBeenCalledTimes(1);
    // A re-render with the same nav state must NOT fire it again.
    rerender();
    rerender();
    expect(startRecording).toHaveBeenCalledTimes(1);
  });

  it("does not auto-start when there is no selected source", () => {
    setupState.selectedSource = null;
    renderAt({ startAt: 100 });
    expect(startRecording).not.toHaveBeenCalled();
  });

  it("does not auto-start while a recording is already active", () => {
    setupState.isRecording = true;
    renderAt({ startAt: 100 });
    expect(startRecording).not.toHaveBeenCalled();
  });

  it("does not auto-start without a startAt flag (a normal visit)", () => {
    renderAt(undefined);
    expect(startRecording).not.toHaveBeenCalled();
  });

  it("opens the source picker once for an openPicker flag", () => {
    const { rerender } = renderAt({ openPicker: 200 });
    expect(openSourcePicker).toHaveBeenCalledTimes(1);
    rerender();
    expect(openSourcePicker).toHaveBeenCalledTimes(1);
  });

  it("drops a start-on-pick whose selection never landed when the picker opens again", () => {
    setupState = {
      selectedSource: SCREEN,
      isRecording: false,
      isSourcePickerOpen: true,
      sources: [WINDOW],
    };
    const { rerender } = renderAt({ openPicker: 300, startOnPick: true });
    fireEvent.click(screen.getByRole("button", { name: /^Windows/ }));
    fireEvent.click(screen.getByText("Safari"));
    // The selection has not round-tripped through main: nothing starts yet.
    expect(startRecording).not.toHaveBeenCalled();

    // The picker is opened again (a plain "Change"), then the window becomes the selection.
    act(() => navigateTo!({ openPicker: 301 }));
    setupState.selectedSource = WINDOW;
    rerender();
    expect(startRecording).not.toHaveBeenCalled();
  });
});

describe("RecordPage idle layout (design Kaipu Record Modes)", () => {
  const realApi = window.electronAPI;
  beforeEach(() => {
    setupState = { selectedSource: SCREEN, isRecording: false };
  });
  afterEach(() => {
    window.electronAPI = realApi;
  });

  it("shows Start, the last used mode with its remembered area, and the inputs", async () => {
    const requestRecordSelector = vi.fn();
    const settings = await realApi.getSettings();
    window.electronAPI = {
      ...realApi,
      requestRecordSelector,
      getSettings: async () => ({
        ...settings,
        recordingMode: "frame",
        recordingArea: { "7": { x: 0, y: 0, width: 1280, height: 720, ratio: "16:9" } },
      }),
    };
    renderAt(undefined);
    expect(screen.getByText("RECORD")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready to record" })).toBeInTheDocument();
    expect(await screen.findByTestId("frame-caption")).toHaveTextContent("16:9 · 1280 × 720");
    expect(screen.getByRole("button", { name: /^Frame/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("SOUND & CAMERA")).toBeInTheDocument();
    // No source card: what to record is picked in the selector.
    expect(screen.queryByText("CHOOSE A SOURCE")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Start recording/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Screen/ }));
    expect(requestRecordSelector.mock.calls).toEqual([[undefined], ["screen"]]);
    // A click never starts a take by itself: main opens the selector first.
    expect(startRecording).not.toHaveBeenCalled();
  });

  it("opens the camera settings drawer from the split Camera tile in the idle layout", () => {
    renderAt(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Camera settings" }));
    expect(screen.getByRole("region", { name: "Camera settings" })).toBeInTheDocument();
  });

  it("opens the Mic and Audio drawers in the page's flow, one at a time", async () => {
    renderAt(undefined);
    await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
    const mic = screen.getByRole("region", { name: "Microphone settings" });
    expect(mic).toBeInTheDocument();
    // In flow, not a floating dialog: it lives in the same block as the tile row.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mic.parentElement).toContainElement(
      screen.getByRole("button", { name: "Microphone settings" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "System audio settings" }));
    expect(screen.getByRole("region", { name: "System audio settings" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Microphone settings" })).toBeNull();
  });

  it("opens the drawers in the recording layout too", async () => {
    setupState.isRecording = true;
    renderAt(undefined);
    await userEvent.click(screen.getByRole("button", { name: "Camera settings" }));
    expect(screen.getByRole("region", { name: "Camera settings" })).toBeInTheDocument();
  });

  it("locks the Mic and Camera settings during the countdown and while starting", async () => {
    setupState.microphoneEnabled = true;
    setupState.cameraEnabled = true;
    setupState.microphones = [{ deviceId: "a", label: "MacBook Pro Microphone" }];
    for (const status of ["counting", "starting", "finalizing"] as const) {
      setupState.recordingStatus = status;
      const { unmount } = render(
        <MemoryRouter>
          <RecordPage />
        </MemoryRouter>,
      );
      await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
      expect(screen.getByText("Live")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Camera settings" }));
      expect(
        screen.getByText("Changes apply live and will show in the recording."),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it("keeps the Mic and Camera settings editable while idle", async () => {
    setupState.microphoneEnabled = true;
    setupState.cameraEnabled = true;
    renderAt(undefined);
    await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
    expect(screen.queryByText("Live")).toBeNull();
  });

  it("no longer renders the old microphone picker row under the toggles", () => {
    setupState.microphoneEnabled = true;
    setupState.microphones = [{ deviceId: "a", label: "MacBook Pro Microphone" }];
    renderAt(undefined);
    expect(screen.queryByText("MICROPHONE")).toBeNull();
    expect(screen.queryByText("MacBook Pro Microphone")).toBeNull();
  });

  it("still shows the permission notice when the microphone is on but access is off", async () => {
    setupState.microphoneEnabled = true;
    setupState.microphoneGranted = false;
    renderAt(undefined);
    expect(await screen.findByText("Microphone access is off")).toBeInTheDocument();
  });

  it("keeps the recording layout while a take runs", () => {
    setupState.isRecording = true;
    renderAt(undefined);
    expect(screen.queryByRole("button", { name: /Start recording/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Stop recording/ })).toBeInTheDocument();
  });
});
