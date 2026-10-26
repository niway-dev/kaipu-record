import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

/** Mutable setup state each test tweaks before rendering. */
let setupState: { selectedSource: typeof SCREEN | null; isRecording: boolean };

function makeSetup(): RecordingSetup {
  return {
    selectedSource: setupState.selectedSource,
    selectSource: vi.fn(),
    isSourcePickerOpen: false,
    openSourcePicker,
    closeSourcePicker: vi.fn(),
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
    isRecording: setupState.isRecording,
    recordingStatus: setupState.isRecording ? "recording" : "idle",
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
  useSourceSelection: () => ({ sources: [], isLoading: false, error: null }),
}));
vi.mock("@renderer/features/permissions", () => ({
  usePermissions: () => ({
    status: { screen: true, microphone: true, camera: true },
    check: vi.fn(async () => {}),
    openSettings: vi.fn(),
  }),
}));

function renderAt(state: Record<string, unknown> | undefined): { rerender: () => void } {
  const ui = (
    <MemoryRouter initialEntries={[{ pathname: "/", state }]}>
      <RecordPage />
    </MemoryRouter>
  );
  const view = render(ui);
  return { rerender: () => view.rerender(ui) };
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

  it("lists the four newest recordings under Recent, and nothing when there are none", async () => {
    const recording = (n: number) => ({
      id: `r${n}`,
      assetId: `a${n}`,
      title: `Take ${n}`,
      filePath: `/v/r${n}.mp4`,
      createdAt: n,
      sizeBytes: 1,
      durationSeconds: 60 + n,
      thumbnailUrl: null,
      kind: "recording" as const,
      derivedFromAssetId: null,
      contentSha256: null,
      capture:
        n === 5
          ? { mode: "area" as const, width: 1280, height: 720, ratio: "16:9" as const }
          : n === 4
            ? { mode: "screen" as const, width: 1920, height: 1080, ratio: null }
            : null,
    });
    window.electronAPI = {
      ...realApi,
      listLocalRecordings: async () => [1, 2, 3, 4, 5].map(recording),
    };
    renderAt(undefined);
    await screen.findByTestId("recent-recordings");
    expect(screen.getAllByText(/^Take/).map((node) => node.textContent)).toEqual([
      "Take 5",
      "Take 4",
      "Take 3",
      "Take 2",
    ]);
    expect(screen.getByText("1:05")).toBeInTheDocument();
    // The capture tag from the library labels each take that has capture metadata.
    expect(screen.getByText("FRAME · 16:9")).toBeInTheDocument();
    expect(screen.getByText("SCREEN")).toBeInTheDocument();
  });

  it("opens the camera settings popover from the split Camera tile in the idle layout", () => {
    renderAt(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Camera settings" }));
    expect(screen.getByRole("dialog", { name: "Camera settings" })).toBeInTheDocument();
  });

  it("keeps the recording layout while a take runs", () => {
    setupState.isRecording = true;
    renderAt(undefined);
    expect(screen.queryByRole("button", { name: /Start recording/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Stop recording/ })).toBeInTheDocument();
  });
});
