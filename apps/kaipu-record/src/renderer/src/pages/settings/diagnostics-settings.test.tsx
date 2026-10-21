import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_SETTINGS } from "@shared/types";
import { DiagnosticsSettings } from "./diagnostics-settings";

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
});
