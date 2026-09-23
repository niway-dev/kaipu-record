import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_SETTINGS } from "@shared/types";
import { ScreenshotSaveSettings } from "./screenshot-save-settings";

describe("ScreenshotSaveSettings", () => {
  it("is on for auto and writes manual when switched off", async () => {
    const update = vi.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, screenshotSave: "manual" });
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    window.electronAPI.updateSettings = update;
    render(<ScreenshotSaveSettings />);

    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).toBeChecked());

    fireEvent.click(toggle);
    expect(update).toHaveBeenCalledWith({ screenshotSave: "manual" });
  });

  it("is off for manual and writes auto when switched on", async () => {
    const update = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    window.electronAPI.getSettings = vi
      .fn()
      .mockResolvedValue({ ...DEFAULT_SETTINGS, screenshotSave: "manual" });
    window.electronAPI.updateSettings = update;
    render(<ScreenshotSaveSettings />);

    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).not.toBeChecked());

    fireEvent.click(toggle);
    expect(update).toHaveBeenCalledWith({ screenshotSave: "auto" });
  });
});
