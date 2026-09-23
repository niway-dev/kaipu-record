import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as i18n from "@kaipu/i18n";
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
    // already-decided flows, where the Accessibility row must stay absent.
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

describe("OnboardingOverlay — Accessibility row (plans/video-editor-v2/03 § UI)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function openPermissions(): Promise<void> {
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled());
  }

  it("is absent while the OS reports it as not required (non-mac)", async () => {
    mockElectronAPI({
      checkPermissions: vi.fn().mockResolvedValue({ screen: true, microphone: true, camera: true }),
    });
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await openPermissions();
    expect(screen.queryByText(/auto-zoom on clicks/i)).toBeNull();
  });

  it("renders as an optional fourth row whose Allow calls requestAccessibility() and never gates Continue", async () => {
    const { requestAccessibility } = mockElectronAPI({
      checkPermissions: vi.fn().mockResolvedValue({ screen: true, microphone: true, camera: true }),
      getAccessibilityStatus: vi.fn().mockResolvedValue("denied"),
      requestAccessibility: vi.fn().mockResolvedValue("denied"),
    });
    const onClose = vi.fn();
    render(<OnboardingOverlay onClose={onClose} />);
    await openPermissions();

    expect(await screen.findByText(/auto-zoom on clicks/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^allow$/i }));
    expect(requestAccessibility).toHaveBeenCalledOnce();

    // Still denied after the prompt — the button stays, Continue is still enabled.
    expect(screen.getByRole("button", { name: /^allow$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByRole("heading", { name: /you're all set/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("flips the row to GRANTED when the permission is granted outside the app (re-read on focus)", async () => {
    const { getAccessibilityStatus } = mockElectronAPI({
      checkPermissions: vi.fn().mockResolvedValue({ screen: true, microphone: true, camera: true }),
      getAccessibilityStatus: vi.fn().mockResolvedValue("denied"),
    });
    render(<OnboardingOverlay onClose={vi.fn()} />);
    await openPermissions();
    await screen.findByRole("button", { name: /^allow$/i });

    // The user alt-tabs to System Settings, grants it, and comes back.
    getAccessibilityStatus.mockResolvedValue("granted");
    fireEvent.focus(window);

    await waitFor(() => expect(screen.queryByRole("button", { name: /^allow$/i })).toBeNull());
    // Still on the permissions step: nothing moved under the user.
    expect(screen.getByRole("heading", { name: /grant permissions/i })).toBeInTheDocument();
  });
});

describe("OnboardingOverlay — permission explanations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the why behind an (i) that opens a popover, instead of a description under the name", async () => {
    mockElectronAPI({
      checkPermissions: vi.fn().mockResolvedValue({ screen: true, microphone: true, camera: true }),
    });
    render(<OnboardingOverlay onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled());

    expect(screen.queryByText(/captures your full display/i)).toBeNull();
    fireEvent.click(screen.getByRole("img", { name: /why screen recording\?/i }));
    expect(screen.getByText(/captures your full display/i)).toBeInTheDocument();
  });
});

describe("OnboardingOverlay — language picker on the welcome step", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers every locale by its own name, marks the active one, and switches via the provider", () => {
    mockElectronAPI();
    // setup.ts stubs `useSetLocale` with a no-op; swap in a spy to assert the write.
    const setLocale = vi.fn();
    vi.spyOn(i18n, "useSetLocale").mockReturnValue(setLocale);
    render(<OnboardingOverlay onClose={vi.fn()} />);

    const group = screen.getByRole("radiogroup", { name: /language/i });
    const es = within(group).getByRole("radio", { name: "Español" });
    const en = within(group).getByRole("radio", { name: "English" });
    // The test setup stubs useLocale to "en".
    expect(en).toHaveAttribute("aria-checked", "true");
    expect(es).toHaveAttribute("aria-checked", "false");

    fireEvent.click(es);
    expect(setLocale).toHaveBeenCalledWith("es");
  });
});
