import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { KaipuElectronAPI, PermissionStatus } from "@shared/types";
import { OnboardingOverlay } from "./onboarding-overlay";

function mockElectronAPI(overrides: Partial<KaipuElectronAPI> = {}): {
  checkPermissions: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
  openSystemSettings: ReturnType<typeof vi.fn>;
} {
  const allDenied: PermissionStatus = { screen: false, microphone: false, camera: false };
  const checkPermissions = vi.fn().mockResolvedValue(allDenied);
  const requestPermission = vi.fn().mockResolvedValue(true);
  const openSystemSettings = vi.fn().mockResolvedValue(undefined);
  window.electronAPI = {
    getScreenSources: vi.fn(),
    resizeCapturePanel: vi.fn(),
    openMainWindow: vi.fn(),
    checkPermissions,
    requestPermission,
    openSystemSettings,
    ...overrides,
  } as unknown as KaipuElectronAPI;
  return { checkPermissions, requestPermission, openSystemSettings };
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
