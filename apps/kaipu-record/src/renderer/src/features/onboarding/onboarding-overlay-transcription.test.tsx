import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultShortcutsFor } from "@shared/shortcut-defaults";
import type { KaipuElectronAPI, PermissionStatus } from "@shared/types";
import type { TranscriptionModelInfo, TranscriptionStatus } from "@shared/types/transcription";
import { OnboardingOverlay } from "./onboarding-overlay";

const flags = vi.hoisted(() => ({ transcription: true }));
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: string) => (name === "transcription" ? flags.transcription : false),
}));

const MODEL_ID = "parakeet-tdt-0.6b-v3-int8";

function transcriptionStatus(
  state: TranscriptionModelInfo["status"] = { state: "missing" },
  availability: TranscriptionStatus["availability"] = { status: "available" },
): TranscriptionStatus {
  return {
    availability,
    defaultModelId: MODEL_ID,
    models: [
      {
        id: MODEL_ID,
        label: "Parakeet TDT 0.6B v3",
        languages: ["en", "es"],
        sizeBytes: 640_000_000,
        location: "/models/parakeet",
        license: { name: "CC-BY-4.0", attribution: "Credit line", url: "https://example.test/l" },
        status: state,
      },
    ],
    job: null,
  };
}

function mockApi(status: TranscriptionStatus, over: Partial<KaipuElectronAPI> = {}) {
  const allGranted: PermissionStatus = { screen: true, microphone: true, camera: true };
  const getTranscriptionStatus = vi.fn().mockResolvedValue(status);
  const downloadTranscriptionModel = vi.fn(() => new Promise<never>(() => {}));
  window.electronAPI = {
    checkPermissions: vi.fn().mockResolvedValue(allGranted),
    requestPermission: vi.fn().mockResolvedValue(true),
    openSystemSettings: vi.fn().mockResolvedValue(undefined),
    getAccessibilityStatus: vi.fn().mockResolvedValue("not-required"),
    requestAccessibility: vi.fn().mockResolvedValue("not-required"),
    setOnboardingWindowMode: vi.fn(),
    getSettings: vi.fn().mockResolvedValue({ shortcuts: defaultShortcutsFor("darwin") }),
    onSettingsChanged: vi.fn(() => () => {}),
    onShortcutFired: vi.fn(() => () => {}),
    requestRecordSelector: vi.fn(),
    requestCaptureScreenshot: vi.fn(),
    getTranscriptionStatus,
    onTranscriptionModelProgress: vi.fn(() => () => {}),
    downloadTranscriptionModel,
    ...over,
  } as unknown as KaipuElectronAPI;
  return { getTranscriptionStatus, downloadTranscriptionModel };
}

const dots = (): HTMLElement[] => screen.getAllByRole("button", { name: /^go to step/i });

async function toShortcuts(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /get started/i }));
  await waitFor(() => expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  await screen.findByRole("heading", { name: /four shortcuts are the whole app/i });
}

async function privacyToDone(): Promise<void> {
  await screen.findByRole("heading", { name: /your recordings are yours/i });
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  await screen.findByRole("heading", { name: /you're set/i });
}

describe("OnboardingOverlay: the Transcription step", () => {
  beforeEach(() => {
    flags.transcription = true;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sits between Shortcuts and Privacy when the model is on offer", async () => {
    mockApi(transcriptionStatus());
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await waitFor(() => expect(dots()).toHaveLength(6));
    await toShortcuts();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await screen.findByRole("heading", { name: /turn recordings into text/i });
    expect(screen.getByText("TRANSCRIPTION · OPTIONAL")).toBeInTheDocument();
    // The step's own two buttons are the way forward: no footer Continue.
    expect(screen.queryByRole("button", { name: /^continue$/i })).toBeNull();
  });

  it("Not now moves past Transcription to Privacy without downloading", async () => {
    const { downloadTranscriptionModel } = mockApi(transcriptionStatus());
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await waitFor(() => expect(dots()).toHaveLength(6));
    await toShortcuts();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    await privacyToDone();
    expect(downloadTranscriptionModel).not.toHaveBeenCalled();
  });

  it("Download in background starts it, never waits for it, and keeps the dots steady", async () => {
    // The mocked download never resolves: reaching You're set proves nothing awaits it.
    const { downloadTranscriptionModel } = mockApi(transcriptionStatus());
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await waitFor(() => expect(dots()).toHaveLength(6));
    await toShortcuts();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Download in background" }));
    await privacyToDone();
    expect(downloadTranscriptionModel).toHaveBeenCalledTimes(1);
    expect(downloadTranscriptionModel).toHaveBeenCalledWith(MODEL_ID);
    // The model is downloading now, yet the step stays in the flow.
    expect(dots()).toHaveLength(6);

    // Back on the step, a second download is not started while the first one runs.
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    await screen.findByRole("heading", { name: /your recordings are yours/i });
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Download in background" }));
    await privacyToDone();
    expect(downloadTranscriptionModel).toHaveBeenCalledTimes(1);
  });

  it("is absent with the flag off, and the status is never read", async () => {
    flags.transcription = false;
    const { getTranscriptionStatus } = mockApi(transcriptionStatus());
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await toShortcuts();
    expect(dots()).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await privacyToDone();
    expect(getTranscriptionStatus).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the engine is unavailable",
      transcriptionStatus(
        { state: "missing" },
        { status: "unavailable", reason: "unsupported-platform" },
      ),
    ],
    ["the model is already installed", transcriptionStatus({ state: "ready" })],
  ])("is absent when %s", async (_name, status) => {
    const { getTranscriptionStatus } = mockApi(status);
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await waitFor(() => expect(getTranscriptionStatus).toHaveBeenCalled());
    await toShortcuts();
    expect(dots()).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await privacyToDone();
  });

  it("is offered again after a download that failed", async () => {
    mockApi(transcriptionStatus({ state: "failed", reason: "network" }));
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await waitFor(() => expect(dots()).toHaveLength(6));
  });

  it("stays on You're set when the offer arrives late, instead of being moved to the new step", async () => {
    let answer: (status: TranscriptionStatus) => void = () => {};
    mockApi(transcriptionStatus(), {
      getTranscriptionStatus: vi.fn(
        () => new Promise<TranscriptionStatus>((resolve) => (answer = resolve)),
      ),
    });
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await toShortcuts();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await privacyToDone();
    expect(dots()).toHaveLength(5);

    answer(transcriptionStatus());

    await waitFor(() => expect(dots()).toHaveLength(6));
    expect(screen.getByRole("heading", { name: /you're set/i })).toBeInTheDocument();
  });

  it("goes to Privacy, not past it, when the offer goes away while Transcription is open", async () => {
    mockApi(transcriptionStatus());
    const { rerender } = render(<OnboardingOverlay onClose={vi.fn()} />);
    await waitFor(() => expect(dots()).toHaveLength(6));
    await toShortcuts();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await screen.findByRole("heading", { name: /turn recordings into text/i });

    flags.transcription = false;
    rerender(<OnboardingOverlay onClose={vi.fn()} />);

    expect(
      await screen.findByRole("heading", { name: /your recordings are yours/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /you're set/i })).toBeNull();
    expect(dots()).toHaveLength(5);
  });

  it("stays on You're set when the flag turns off after the offer was shown", async () => {
    mockApi(transcriptionStatus());
    const { rerender } = render(<OnboardingOverlay onClose={vi.fn()} />);
    await waitFor(() => expect(dots()).toHaveLength(6));
    await toShortcuts();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    await privacyToDone();

    flags.transcription = false;
    rerender(<OnboardingOverlay onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: /you're set/i })).toBeInTheDocument();
    expect(dots()).toHaveLength(5);
  });
});
