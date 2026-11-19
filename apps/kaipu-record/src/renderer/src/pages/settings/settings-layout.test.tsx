import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, Navigate, RouterProvider } from "react-router-dom";
import { OnboardingContext } from "@renderer/features/onboarding/onboarding-context";
import { SettingsLayout } from "./settings-layout";
import {
  AppSettingsPage,
  GeneralSettingsPage,
  PermissionsSettingsPage,
  RecordingQualitySettingsPage,
  RecordingSettingsPage,
  TranscriptionSettingsPage,
  WorkspacesSettingsPage,
} from "./settings-pages";
import { WorkspacesProvider } from "@renderer/features/workspaces/workspaces-context";

// `useFlag` reads PostHog; the tests pin each side of the transcription flag.
const flags = vi.hoisted(() => ({ transcription: false }) as Record<string, boolean>);
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: string) => flags[name] ?? false,
}));

function renderAt(path: string, open = vi.fn()) {
  const router = createMemoryRouter(
    [
      { path: "/cloud", element: <p>cloud page</p> },
      {
        path: "/settings",
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="general" replace /> },
          { path: "general", element: <GeneralSettingsPage /> },
          { path: "permissions", element: <PermissionsSettingsPage /> },
          { path: "recording-quality", element: <RecordingQualitySettingsPage /> },
          { path: "recording", element: <RecordingSettingsPage /> },
          { path: "transcription", element: <TranscriptionSettingsPage /> },
          { path: "workspaces", element: <WorkspacesSettingsPage /> },
          { path: "app", element: <AppSettingsPage /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <OnboardingContext.Provider value={{ isOpen: false, open }}>
      <WorkspacesProvider>
        <RouterProvider router={router} />
      </WorkspacesProvider>
    </OnboardingContext.Provider>,
  );
  return router;
}

describe("Settings layout", () => {
  it("opens General by default and lists every wired page in its nav", async () => {
    renderAt("/settings");
    expect(await screen.findByRole("heading", { level: 1, name: "General" })).toBeInTheDocument();
    // NIW2-626: the page heading is the only title; no "Settings" eyebrow repeats the rail.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const nav = screen.getByRole("navigation", { name: "Settings" });
    for (const name of [
      "General",
      "Permissions",
      "Recording quality",
      "Recording",
      "Workspaces",
      "App",
    ]) {
      expect(
        nav.querySelector(
          `a[href="/settings/${name === "Recording quality" ? "recording-quality" : name.toLowerCase()}"]`,
        ),
      ).not.toBeNull();
    }
    expect(screen.getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page");
  });

  it("lists Transcription in the nav only with the transcription flag on", async () => {
    renderAt("/settings");
    await screen.findByRole("heading", { level: 1, name: "General" });
    expect(screen.queryByRole("link", { name: "Transcription" })).not.toBeInTheDocument();
    cleanup();

    flags.transcription = true;
    try {
      renderAt("/settings");
      const link = await screen.findByRole("link", { name: "Transcription" });
      expect(link).toHaveAttribute("href", "/settings/transcription");
    } finally {
      flags.transcription = false;
    }
  });

  it("does not bring back unwired placeholder settings", async () => {
    renderAt("/settings");
    await screen.findByRole("heading", { level: 1, name: "General" });
    expect(
      screen.queryByRole("link", { name: /devices|storage & uploads|keyboard shortcuts/i }),
    ).not.toBeInTheDocument();
  });

  it("points the account to the Cloud page from General", async () => {
    const router = renderAt("/settings/general");
    fireEvent.click(await screen.findByRole("button", { name: "Go to Cloud" }));
    expect(router.state.location.pathname).toBe("/cloud");
  });

  it("navigates between pages", async () => {
    renderAt("/settings/general");
    fireEvent.click(await screen.findByRole("link", { name: "Permissions" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Permissions" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /request/i }).length).toBeGreaterThan(0);
  });

  it("Workspaces lists each workspace with its folder, opens it, and offers New workspace", async () => {
    const openFolder = vi.spyOn(window.electronAPI.workspaces, "openFolder");
    const add = vi.spyOn(window.electronAPI.workspaces, "add");
    renderAt("/settings/workspaces");
    expect(await screen.findByText("/tmp/vault · Active")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show folder" }));
    expect(openFolder).toHaveBeenCalledWith("ws-default");
    // With one workspace there is nothing to remove: it is the active and the last one.
    expect(screen.queryByRole("button", { name: "Remove from list" })).toBeNull();
    // New workspace opens the dialog; the folder picker is its secondary link.
    fireEvent.click(screen.getByRole("button", { name: "New workspace" }));
    expect(add).not.toHaveBeenCalled();
    expect(await screen.findByRole("alertdialog", { name: "New workspace" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use an existing folder…" }));
    expect(add).toHaveBeenCalledOnce();
    openFolder.mockRestore();
    add.mockRestore();
  });

  it("App replays onboarding", async () => {
    const open = vi.fn();
    renderAt("/settings/app", open);
    fireEvent.click(await screen.findByRole("button", { name: /replay/i }));
    expect(open).toHaveBeenCalledOnce();
  });

  it("App shows the Dock toggle on macOS", async () => {
    renderAt("/settings/app");
    expect(await screen.findByText("Show in Dock & app switcher")).toBeInTheDocument();
  });

  it("App hides the Dock toggle entirely on Windows, where there is no Dock", async () => {
    const api = window.electronAPI as { platform: string };
    const original = api.platform;
    api.platform = "win32";
    try {
      renderAt("/settings/app");
      await screen.findByRole("button", { name: /replay/i });
      expect(screen.queryByText("Show in Dock & app switcher")).toBeNull();
      expect(screen.queryByText(/⌘|Dock/)).toBeNull();
    } finally {
      api.platform = original;
    }
  });

  it("Permissions hides the Accessibility row when it's not required (non-macOS, or the stub default)", async () => {
    renderAt("/settings/permissions");
    await screen.findByRole("heading", { level: 1, name: "Permissions" });
    expect(screen.queryByText("Zoom on clicks (Accessibility)")).toBeNull();
  });

  it("Recording does not carry the Accessibility row — it lives with the other OS permissions", async () => {
    const getAccessibilityStatus = vi
      .spyOn(window.electronAPI, "getAccessibilityStatus")
      .mockResolvedValue("denied");
    renderAt("/settings/recording");
    await screen.findByRole("heading", { level: 1, name: "Recording" });
    expect(screen.queryByText("Zoom on clicks (Accessibility)")).toBeNull();
    getAccessibilityStatus.mockRestore();
  });

  it("Permissions shows the Accessibility row and calls requestAccessibility() (the Settings-side call site, see plans/video-editor-v2/03 § UI)", async () => {
    const getAccessibilityStatus = vi
      .spyOn(window.electronAPI, "getAccessibilityStatus")
      .mockResolvedValue("denied");
    const requestAccessibility = vi
      .spyOn(window.electronAPI, "requestAccessibility")
      .mockResolvedValue("granted");
    renderAt("/settings/permissions");

    expect(await screen.findByText("Zoom on clicks (Accessibility)")).toBeInTheDocument();
    // The stub grants screen/mic/camera, so the only ungranted row — and therefore the
    // only "Request" button — is Accessibility's.
    fireEvent.click(await screen.findByRole("button", { name: "Request" }));
    expect(requestAccessibility).toHaveBeenCalledOnce();

    await waitFor(() => expect(screen.queryByRole("button", { name: "Request" })).toBeNull());
    expect(screen.getAllByRole("button", { name: "Re-request" })).toHaveLength(4);

    getAccessibilityStatus.mockRestore();
    requestAccessibility.mockRestore();
  });

  it("turns the post-recording Where is it going panel off from Export quality (NIW2-578)", async () => {
    const updateSettings = vi
      .spyOn(window.electronAPI, "updateSettings")
      .mockImplementation(async (patch) => ({
        ...(await window.electronAPI.getSettings()),
        ...patch,
      }));
    renderAt("/settings/recording-quality");
    const toggle = await screen.findByRole("switch", {
      name: "Ask where a new recording is going",
    });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(toggle);
    expect(updateSettings).toHaveBeenCalledWith({ showRecordingSavedCard: false });
    updateSettings.mockRestore();
  });
});
