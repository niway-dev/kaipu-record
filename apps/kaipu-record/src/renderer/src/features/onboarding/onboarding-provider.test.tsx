import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultShortcutsFor } from "@shared/shortcut-defaults";
import type { KaipuElectronAPI } from "@shared/types";
import { OnboardingProvider } from "./onboarding-provider";
import {
  hasCompletedOnboarding,
  hasSeenPrivacyNotice,
  markOnboardingComplete,
  markPrivacySeen,
} from "./onboarding-store";

function mockApi(overrides: Partial<KaipuElectronAPI> = {}): {
  updateSettings: ReturnType<typeof vi.fn>;
} {
  const api = {
    checkPermissions: vi.fn().mockResolvedValue({ screen: true, microphone: true, camera: false }),
    requestPermission: vi.fn().mockResolvedValue(true),
    openSystemSettings: vi.fn().mockResolvedValue(undefined),
    getAccessibilityStatus: vi.fn().mockResolvedValue("not-required"),
    requestAccessibility: vi.fn().mockResolvedValue("not-required"),
    setOnboardingWindowMode: vi.fn(),
    getSettings: vi.fn().mockResolvedValue({ shortcuts: defaultShortcutsFor("darwin") }),
    onSettingsChanged: vi.fn(() => () => {}),
    onShortcutFired: vi.fn(() => () => {}),
    updateSettings: vi.fn(async (patch: object) => ({ ...patch })),
    requestRecordSelector: vi.fn(),
    requestCaptureScreenshot: vi.fn(),
    ...overrides,
  } as unknown as KaipuElectronAPI;
  window.electronAPI = api;
  return { updateSettings: api.updateSettings as ReturnType<typeof vi.fn> };
}

const NOTICE = /your recordings are yours/i;

describe("OnboardingProvider — privacy notice", () => {
  beforeEach(() => {
    localStorage.clear();
    mockApi();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows the notice once to someone who finished onboarding before the step existed", async () => {
    markOnboardingComplete();
    render(
      <OnboardingProvider>
        <p>app</p>
      </OnboardingProvider>,
    );
    expect(await screen.findByRole("heading", { name: NOTICE })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /share usage and crash reports/i })).toBeChecked(),
    );
    // Not the full-window tour: the app is still behind it.
    expect(screen.getByText("app")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /get started/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(screen.queryByRole("heading", { name: NOTICE })).toBeNull();
    expect(hasSeenPrivacyNotice()).toBe(true);
  });

  it("never shows it again once dismissed", () => {
    markOnboardingComplete();
    markPrivacySeen();
    render(
      <OnboardingProvider>
        <p>app</p>
      </OnboardingProvider>,
    );
    expect(screen.queryByRole("heading", { name: NOTICE })).toBeNull();
  });

  it("Esc dismisses it for good, like Got it", async () => {
    markOnboardingComplete();
    render(
      <OnboardingProvider>
        <p>app</p>
      </OnboardingProvider>,
    );
    const dialog = (await screen.findByRole("heading", { name: NOTICE })).closest(
      '[role="alertdialog"]',
    ) as HTMLElement;
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("heading", { name: NOTICE })).toBeNull();
    expect(hasSeenPrivacyNotice()).toBe(true);
  });

  it("a click on the backdrop dismisses it for good, a click inside the card does not", async () => {
    markOnboardingComplete();
    render(
      <OnboardingProvider>
        <p>app</p>
      </OnboardingProvider>,
    );
    const heading = await screen.findByRole("heading", { name: NOTICE });
    const dialog = heading.closest('[role="alertdialog"]') as HTMLElement;
    fireEvent.click(heading);
    expect(screen.getByRole("heading", { name: NOTICE })).toBeInTheDocument();
    expect(hasSeenPrivacyNotice()).toBe(false);
    fireEvent.click(dialog);
    expect(screen.queryByRole("heading", { name: NOTICE })).toBeNull();
    expect(hasSeenPrivacyNotice()).toBe(true);
  });

  it("the toggle in the notice writes the setting", async () => {
    markOnboardingComplete();
    const { updateSettings } = mockApi();
    render(
      <OnboardingProvider>
        <p>app</p>
      </OnboardingProvider>,
    );
    const toggle = await screen.findByRole("switch", { name: /share usage and crash reports/i });
    await waitFor(() => expect(toggle).toBeEnabled());
    fireEvent.click(toggle);
    expect(updateSettings).toHaveBeenCalledWith({ diagnosticsEnabled: false });
  });

  it("does not stack on the tour for a new user: the step is part of the flow", async () => {
    render(
      <OnboardingProvider>
        <p>app</p>
      </OnboardingProvider>,
    );
    expect(await screen.findByRole("button", { name: /get started/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: NOTICE })).toBeNull();
  });

  it("owes the notice to someone who skips the tour before reaching the step", async () => {
    render(
      <OnboardingProvider>
        <p>app</p>
      </OnboardingProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /skip to permissions/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /skip the tour/i }));
    expect(hasCompletedOnboarding()).toBe(true);
    expect(await screen.findByRole("heading", { name: NOTICE })).toBeInTheDocument();
  });
});
