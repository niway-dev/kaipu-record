import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, Navigate, RouterProvider } from "react-router-dom";
import { OnboardingContext } from "@renderer/features/onboarding/onboarding-context";
import { SettingsLayout } from "./settings-layout";
import {
  AppSettingsPage,
  FilesSettingsPage,
  GeneralSettingsPage,
  PermissionsSettingsPage,
  RecordingQualitySettingsPage,
  RecordingSettingsPage,
} from "./settings-pages";

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
          { path: "files", element: <FilesSettingsPage /> },
          { path: "app", element: <AppSettingsPage /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <OnboardingContext.Provider value={{ isOpen: false, open }}>
      <RouterProvider router={router} />
    </OnboardingContext.Provider>,
  );
  return router;
}

describe("Settings layout", () => {
  it("opens General by default and lists every wired page in its nav", async () => {
    renderAt("/settings");
    expect(await screen.findByRole("heading", { level: 2, name: "General" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Settings" });
    for (const name of [
      "General",
      "Permissions",
      "Recording quality",
      "Recording",
      "Files",
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

  it("does not bring back unwired placeholder settings", async () => {
    renderAt("/settings");
    await screen.findByRole("heading", { level: 2, name: "General" });
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
      await screen.findByRole("heading", { level: 2, name: "Permissions" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /request/i }).length).toBeGreaterThan(0);
  });

  it("Files shows the vault and opens it", async () => {
    const openFolder = vi.spyOn(window.electronAPI, "openVaultDirectory");
    renderAt("/settings/files");
    expect(await screen.findByText("/tmp/vault · Default")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
    expect(openFolder).toHaveBeenCalledOnce();
    openFolder.mockRestore();
  });

  it("App replays onboarding", async () => {
    const open = vi.fn();
    renderAt("/settings/app", open);
    fireEvent.click(await screen.findByRole("button", { name: /replay/i }));
    expect(open).toHaveBeenCalledOnce();
  });

  it("Permissions hides the Accessibility row when it's not required (non-macOS, or the stub default)", async () => {
    renderAt("/settings/permissions");
    await screen.findByRole("heading", { level: 2, name: "Permissions" });
    expect(screen.queryByText("Zoom on clicks (Accessibility)")).toBeNull();
  });

  it("Recording does not carry the Accessibility row — it lives with the other OS permissions", async () => {
    const getAccessibilityStatus = vi
      .spyOn(window.electronAPI, "getAccessibilityStatus")
      .mockResolvedValue("denied");
    renderAt("/settings/recording");
    await screen.findByRole("heading", { level: 2, name: "Recording" });
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
});
