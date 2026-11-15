import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router-dom";
import type { RecorderStatus } from "@renderer/features/recording/recorder-store";
import type { RecordingSetup } from "@renderer/features/recording/hooks/use-recording-setup";
import { RecordPage } from "./record-page";
import { WorkspacesProvider } from "@renderer/features/workspaces/workspaces-context";
import { WorkspaceSwitcher } from "@renderer/features/workspaces/workspace-switcher";

// The record page is composition over hooks; mock them so we can drive the
// auto-start / open-picker effects (finding 15 — the subtlest logic in the app,
// previously untested).
const {
  startRecording,
  openSourcePicker,
  toggleMicrophone,
  toggleCamera,
  stopRecording,
  pauseRecording,
  resumeRecording,
  activity,
} = vi.hoisted(() => ({
  startRecording: vi.fn(),
  openSourcePicker: vi.fn(),
  toggleMicrophone: vi.fn(),
  toggleCamera: vi.fn(),
  stopRecording: vi.fn(),
  pauseRecording: vi.fn(),
  resumeRecording: vi.fn(),
  /** What the recording activity hook reports; a test changes it before rendering. */
  activity: {
    active: false,
    status: "recording" as "recording" | "paused",
    elapsedSeconds: 0,
  },
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
  selectedMicrophone?: { deviceId: string; label: string } | null;
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
    toggleMicrophone,
    toggleSystemAudio: vi.fn(),
    toggleCamera,
    microphones: setupState.microphones ?? [],
    selectedMicrophone: setupState.selectedMicrophone ?? null,
    selectMicrophone: vi.fn(),
    isRecording: setupState.isRecording,
    recordingStatus: setupState.recordingStatus ?? (setupState.isRecording ? "recording" : "idle"),
    countdown: null,
    canStartRecording: setupState.selectedSource !== null && !setupState.isRecording,
    startRecording,
    stopRecording,
    toggleRecording: vi.fn(),
    pauseRecording,
    resumeRecording,
  };
}

vi.mock("@renderer/features/recording/hooks/use-recording-setup", () => ({
  useRecordingSetup: () => makeSetup(),
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
vi.mock("@renderer/features/recording/hooks/use-recording-activity", () => ({
  useRecordingActivity: () => activity,
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
      <WorkspacesProvider>
        <NavProbe />
        <WorkspaceSwitcher />
        <RecordPage />
      </WorkspacesProvider>
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

  it("passes skipCountdown when main says the overlay already counted down", () => {
    renderAt({ startAt: 100, skipCountdown: true });
    expect(startRecording).toHaveBeenCalledExactlyOnceWith({ skipCountdown: true });
  });

  it("a plain startAt starts with no options", () => {
    renderAt({ startAt: 100 });
    expect(startRecording).toHaveBeenCalledExactlyOnceWith();
  });

  it("does not start again when the page remounts on the same history entry (Back from the new take)", () => {
    // The router keeps `state` on the history entry, so Back to "/" remounts the page with the
    // old `startAt`. The first start consumes it: a remount must not begin another take.
    const ui = (show: boolean): React.JSX.Element => (
      <MemoryRouter
        initialEntries={[{ pathname: "/", state: { startAt: 100, skipCountdown: true } }]}
      >
        <WorkspacesProvider>{show ? <RecordPage /> : null}</WorkspacesProvider>
      </MemoryRouter>
    );
    const view = render(ui(true));
    expect(startRecording).toHaveBeenCalledExactlyOnceWith({ skipCountdown: true });
    view.rerender(ui(false));
    view.rerender(ui(true));
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

describe("RecordPage idle layout (design Kaipu Capture Home)", () => {
  const realApi = window.electronAPI;
  beforeEach(() => {
    setupState = { selectedSource: SCREEN, isRecording: false };
  });
  afterEach(() => {
    window.electronAPI = realApi;
  });

  it("is the Capture page: heading, workspace, two entry cards, the Instant line and the setup", async () => {
    renderAt(undefined);
    expect(await screen.findByRole("heading", { level: 1, name: "Capture" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("to Default workspace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch" })).toBeInTheDocument();
    // The old Record page's furniture is gone.
    expect(screen.queryByRole("button", { name: /Start recording/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Window/ })).toBeNull();
    expect(screen.queryByText("Record to Default workspace")).toBeNull();
    expect(screen.queryByText("Ready to record")).toBeNull();

    expect(screen.getByRole("button", { name: /^Screenshot/ })).toHaveTextContent(
      "Pick an area, then annotate or copy it.",
    );
    expect(screen.getByRole("button", { name: /^Recording/ })).toHaveTextContent(
      "Pick an area, then record with sound and camera.",
    );
    // The Instant line is text with a keycap, not a button.
    expect(
      screen.getByText("captures the screen under the cursor at once, without the selector."),
    ).toBeVisible();
    expect(screen.getByText("⌃⌘X")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Instant/ })).toBeNull();

    expect(screen.getByRole("heading", { level: 2, name: "Recording setup" })).toBeInTheDocument();
    expect(
      screen.getByText("Set once. In the selector you only turn these on or off."),
    ).toBeInTheDocument();
    // No source card: what to record is picked in the selector.
    expect(screen.queryByText("CHOOSE A SOURCE")).toBeNull();
  });

  it("shows the last used mode on each card, and the Frame aspect on the Recording one", async () => {
    const settings = await realApi.getSettings();
    window.electronAPI = {
      ...realApi,
      getSettings: async () => ({
        ...settings,
        screenshotMode: "screen",
        recordingMode: "frame",
        recordingArea: { "7": { x: 0, y: 0, width: 1280, height: 720, ratio: "16:9" } },
      }),
    };
    renderAt(undefined);
    expect(await screen.findByText("Last used · Screen")).toBeInTheDocument();
    expect(screen.getByText("Last used · Frame · 16:9")).toBeInTheDocument();
  });

  it("opens the selector from the cards, leaving both modes to main", async () => {
    const requestCaptureScreenshot = vi.fn();
    const requestRecordSelector = vi.fn();
    const settings = await realApi.getSettings();
    window.electronAPI = {
      ...realApi,
      requestCaptureScreenshot,
      requestRecordSelector,
      getSettings: async () => ({ ...settings, screenshotMode: "screen" }),
    };
    renderAt(undefined);
    await screen.findByText("Last used · Screen");
    fireEvent.click(screen.getByRole("button", { name: /^Screenshot/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Recording/ }));
    // No mode: main opens the selector in the stored mode of each.
    expect(requestCaptureScreenshot.mock.calls).toEqual([[]]);
    expect(requestRecordSelector.mock.calls).toEqual([[]]);
    // A click never starts a take by itself: main opens the selector first.
    expect(startRecording).not.toHaveBeenCalled();
  });

  it("Switch beside the heading opens the workspace list, with Add workspace when there is one", async () => {
    renderAt(undefined);
    fireEvent.click(await screen.findByRole("button", { name: "Switch" }));
    const menu = screen.getByRole("menu");
    expect(menu).toHaveTextContent("Default workspace");
    expect(screen.getByRole("menuitem", { name: /New workspace/ })).toBeInTheDocument();
  });

  it("shows the setup as three cards with the current choice, and flips them from their switches", async () => {
    setupState.microphoneEnabled = true;
    setupState.selectedMicrophone = { deviceId: "a", label: "Yeti Nano" };
    toggleMicrophone.mockClear();
    toggleCamera.mockClear();
    renderAt(undefined);
    expect(screen.getByText("Microphone")).toBeInTheDocument();
    expect(screen.getByText("Yeti Nano")).toBeInTheDocument();
    expect(screen.getByText("System audio")).toBeInTheDocument();
    expect(screen.getByText("All sound")).toBeInTheDocument();
    expect(screen.getByText("Camera")).toBeInTheDocument();
    expect(await screen.findByText("Default camera · circle, M")).toBeInTheDocument();

    const mic = screen.getByRole("switch", { name: "Microphone" });
    expect(mic).toHaveAttribute("aria-checked", "true");
    await userEvent.click(mic);
    expect(toggleMicrophone).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("switch", { name: "Camera" }));
    expect(toggleCamera).toHaveBeenCalledOnce();
    // The switch only flips the setting: no panel opens.
    expect(screen.queryByRole("region")).toBeNull();
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
});

describe("RecordPage while a take runs", () => {
  const realApi = window.electronAPI;
  beforeEach(() => {
    setupState = { selectedSource: SCREEN, isRecording: true };
    activity.status = "recording";
    activity.elapsedSeconds = 0;
    stopRecording.mockClear();
    pauseRecording.mockClear();
    resumeRecording.mockClear();
  });
  afterEach(() => {
    window.electronAPI = realApi;
  });

  it("stays the Capture page: the heading and Switch remain", async () => {
    renderAt(undefined);
    expect(screen.getByRole("heading", { level: 1, name: "Capture" })).toBeInTheDocument();
    expect(await screen.findByText("to Default workspace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Recording setup" })).toBeInTheDocument();
  });

  it("shows one bar with the state, the source and the clock, above the capture cards", () => {
    activity.elapsedSeconds = 42;
    renderAt(undefined);
    const bar = document.querySelector('[data-ui-area="record.recordingIndicator"]')!;
    expect(bar).toHaveTextContent("Recording");
    expect(bar).toHaveTextContent("Display 1");
    expect(bar).toHaveTextContent("00:00:42");
    expect(
      bar.compareDocumentPosition(screen.getByRole("button", { name: /^Screenshot/ })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 1 }).compareDocumentPosition(bar) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("leaves the source out of the bar when none is selected", () => {
    setupState.selectedSource = null;
    renderAt(undefined);
    const bar = document.querySelector('[data-ui-area="record.recordingIndicator"]')!;
    expect(bar).toHaveTextContent("Recording");
    expect(bar).not.toHaveTextContent("Display 1");
  });

  it("shows Paused and Resume while paused, and Resume calls resumeRecording", async () => {
    activity.status = "paused";
    renderAt(undefined);
    const bar = document.querySelector('[data-ui-area="record.recordingIndicator"]')!;
    expect(bar).toHaveTextContent("Paused");
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(resumeRecording).toHaveBeenCalledOnce();
  });

  it("Pause and Stop recording call their handlers", async () => {
    renderAt(undefined);
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(pauseRecording).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: /Stop recording/ }));
    expect(stopRecording).toHaveBeenCalledOnce();
  });

  it("groups Pause and Stop under the recordingControls area", () => {
    renderAt(undefined);
    const controls = document.querySelector('[data-ui-area="record.recordingControls"]')!;
    expect(controls).toContainElement(screen.getByRole("button", { name: "Pause" }));
    expect(controls).toContainElement(screen.getByRole("button", { name: /Stop recording/ }));
  });

  it("disables the Screenshot and Recording cards: they do not open the selector", async () => {
    const requestCaptureScreenshot = vi.fn();
    const requestRecordSelector = vi.fn();
    window.electronAPI = { ...realApi, requestCaptureScreenshot, requestRecordSelector };
    renderAt(undefined);
    const screenshot = screen.getByRole("button", { name: /^Screenshot/ });
    const recording = screen.getByRole("button", { name: /^Recording/ });
    expect(screenshot).toBeDisabled();
    expect(recording).toBeDisabled();
    await userEvent.click(screenshot);
    await userEvent.click(recording);
    expect(requestCaptureScreenshot).not.toHaveBeenCalled();
    expect(requestRecordSelector).not.toHaveBeenCalled();
  });

  it("keeps the Instant line visible but dimmed with the cards", () => {
    renderAt(undefined);
    const line = screen.getByText("Instant").closest("[data-ui-area]")!;
    expect(line.closest("[data-disabled]")).not.toBeNull();
  });

  it("keeps the setup row live: the switches still flip and the panels still open", async () => {
    toggleMicrophone.mockClear();
    toggleCamera.mockClear();
    renderAt(undefined);
    await userEvent.click(screen.getByRole("switch", { name: "Microphone" }));
    expect(toggleMicrophone).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("switch", { name: "Camera" }));
    expect(toggleCamera).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Camera settings" }));
    expect(screen.getByRole("region", { name: "Camera settings" })).toBeInTheDocument();
  });

  it("drops the old separate recording layout: no locked source card, no stop hint", () => {
    renderAt(undefined);
    expect(screen.queryByText("Stop from here or the floating bar")).toBeNull();
    expect(screen.queryByText("CHOOSE A SOURCE")).toBeNull();
  });

  it("keeps the source picker working while a take runs", () => {
    setupState.isSourcePickerOpen = true;
    setupState.sources = [WINDOW];
    renderAt(undefined);
    expect(screen.getByRole("button", { name: /^Windows/ })).toBeInTheDocument();
  });
});
