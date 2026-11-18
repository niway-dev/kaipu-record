import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_SETTINGS } from "@shared/types";
import { DiagnosticsSettings } from "./diagnostics-settings";

/** `platform` is read-only in the typed API; a test stands in for the preload's value. */
function setPlatform(platform: string): void {
  (window.electronAPI as { platform: string }).platform = platform;
}

describe("DiagnosticsSettings", () => {
  it("is on by default and writes false when switched off", async () => {
    const update = vi.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, diagnosticsEnabled: false });
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    window.electronAPI.updateSettings = update;
    render(<DiagnosticsSettings />);

    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).toBeChecked());

    fireEvent.click(toggle);
    expect(update).toHaveBeenCalledWith({ diagnosticsEnabled: false });
  });

  it("reflects a stored off state and writes true when switched on", async () => {
    const update = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    window.electronAPI.getSettings = vi
      .fn()
      .mockResolvedValue({ ...DEFAULT_SETTINGS, diagnosticsEnabled: false });
    window.electronAPI.updateSettings = update;
    render(<DiagnosticsSettings />);

    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).not.toBeChecked());

    fireEvent.click(toggle);
    expect(update).toHaveBeenCalledWith({ diagnosticsEnabled: true });
  });

  it("says what is shared and what never is, and never claims nothing is sent", async () => {
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    window.electronAPI.updateSettings = vi.fn();
    render(<DiagnosticsSettings />);

    expect(await screen.findByText("Share usage and crash reports")).toBeInTheDocument();
    expect(
      screen.getByText(/which features you use and when something breaks/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/never your recordings, screen or files/i)).toBeInTheDocument();
    expect(
      screen.getByText(/still checks which features are on for this mac/i),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nothing is sent|only with your permission/i);
  });

  it("says this computer, not this Mac, on Windows", async () => {
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    window.electronAPI.updateSettings = vi.fn();
    setPlatform("win32");
    try {
      render(<DiagnosticsSettings />);
      expect(await screen.findByText(/for this computer/i)).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/\bMac\b/);
    } finally {
      setPlatform("darwin");
    }
  });
});
