import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { KaipuElectronAPI, PermissionStatus } from "@shared/types";
import { OnboardingOverlay } from "./onboarding-overlay";

function mockElectronAPI(overrides: Partial<KaipuElectronAPI> = {}): {
  checkPermissions: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
  openSystemSettings: ReturnType<typeof vi.fn>;
  getAccessibilityStatus: ReturnType<typeof vi.fn>;
  requestAccessibility: ReturnType<typeof vi.fn>;
} {
  const allDenied: PermissionStatus = { screen: false, microphone: false, camera: false };
  // Built as one object, `overrides` applied last, so the returned mocks below are
  // always the EFFECTIVE ones actually wired to window.electronAPI — a caller that
  // overrides e.g. requestAccessibility must get its own mock back, not a default one
  // that was shadowed by the spread and never actually called.
  const api = {
    getScreenSources: vi.fn(),
    resizeCapturePanel: vi.fn(),
    openMainWindow: vi.fn(),
    checkPermissions: vi.fn().mockResolvedValue(allDenied),
    requestPermission: vi.fn().mockResolvedValue(true),
    openSystemSettings: vi.fn().mockResolvedValue(undefined),
    // Default "not-required": every existing test in this file exercises non-mac /
    // already-decided flows, where the Accessibility step must stay absent.
    getAccessibilityStatus: vi.fn().mockResolvedValue("not-required"),
    requestAccessibility: vi.fn().mockResolvedValue("not-required"),
    ...overrides,
  } as unknown as KaipuElectronAPI;
  window.electronAPI = api;
  return {
    checkPermissions: api.checkPermissions as ReturnType<typeof vi.fn>,
    requestPermission: api.requestPermission as ReturnType<typeof vi.fn>,
    openSystemSettings: api.openSystemSettings as ReturnType<typeof vi.fn>,
    getAccessibilityStatus: api.getAccessibilityStatus as ReturnType<typeof vi.fn>,
    requestAccessibility: api.requestAccessibility as ReturnType<typeof vi.fn>,
  };
}

describe("OnboardingOverlay", () => {
  beforeEach(() => {
    mockElectronAPI();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts on the welcome step", () => {
    render(<OnboardingOverlay onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /welcome to kaipu/i })).toBeInTheDocument();
  });

  it("advances from welcome to the permissions step", () => {
    render(<OnboardingOverlay onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    expect(screen.getByRole("heading", { name: /grant permissions/i })).toBeInTheDocument();
  });

  it("gates Continue until the required permissions are granted", async () => {
    mockElectronAPI();
    render(<OnboardingOverlay onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));

    const continueBtn = screen.getByRole("button", { name: /continue/i });
    expect(continueBtn).toBeDisabled();

    const grantButtons = screen.getAllByRole("button", { name: /^grant$/i });
    fireEvent.click(grantButtons[0]); // screen
    fireEvent.click(grantButtons[1]); // microphone

    await waitFor(() => expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled());
  });

  it("calls onClose when Skip setup is clicked", () => {
    const onClose = vi.fn();
    render(<OnboardingOverlay onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /skip setup/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("reaches the final step and finishes via the CTA", async () => {
    mockElectronAPI({
      checkPermissions: vi
        .fn()
        .mockResolvedValue({ screen: true, microphone: true, camera: false }),
    });
    const onClose = vi.fn();
    render(<OnboardingOverlay onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("OnboardingOverlay — Accessibility step (plans/video-editor-v2/03 § UI)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts the step between Permissions and Done only while macOS reports it as not yet granted", async () => {
    mockElectronAPI({
      checkPermissions: vi.fn().mockResolvedValue({ screen: true, microphone: true, camera: true }),
      getAccessibilityStatus: vi.fn().mockResolvedValue("denied"),
    });
    render(<OnboardingOverlay onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(
      await screen.findByRole("heading", { name: /auto-zoom on clicks/i }),
    ).toBeInTheDocument();
    // "Not now" replaces the generic "Continue" label on this optional step.
    expect(screen.getByRole("button", { name: /not now/i })).toBeInTheDocument();
  });

  it("Allow calls requestAccessibility(), and Not now advances to Done without granting", async () => {
    const { requestAccessibility } = mockElectronAPI({
      checkPermissions: vi.fn().mockResolvedValue({ screen: true, microphone: true, camera: true }),
      getAccessibilityStatus: vi.fn().mockResolvedValue("denied"),
      requestAccessibility: vi.fn().mockResolvedValue("denied"),
    });
    const onClose = vi.fn();
    render(<OnboardingOverlay onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await screen.findByRole("heading", { name: /auto-zoom on clicks/i });

    fireEvent.click(screen.getByRole("button", { name: /^allow$/i }));
    expect(requestAccessibility).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(await screen.findByRole("heading", { name: /you're all set/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
