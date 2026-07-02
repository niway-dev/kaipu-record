import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
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
