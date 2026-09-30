import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_SETTINGS } from "@shared/types";
import { ScreenshotCopySettings } from "./screenshot-copy-settings";

describe("ScreenshotCopySettings", () => {
  it("is on for auto and writes manual when switched off", async () => {
    const update = vi.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, screenshotCopy: "manual" });
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    window.electronAPI.updateSettings = update;
    render(<ScreenshotCopySettings />);

    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).toBeChecked());

    fireEvent.click(toggle);
    expect(update).toHaveBeenCalledWith({ screenshotCopy: "manual" });
  });

  it("is off for manual and writes auto when switched on", async () => {
    const update = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    window.electronAPI.getSettings = vi
      .fn()
      .mockResolvedValue({ ...DEFAULT_SETTINGS, screenshotCopy: "manual" });
    window.electronAPI.updateSettings = update;
    render(<ScreenshotCopySettings />);

    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).not.toBeChecked());

    fireEvent.click(toggle);
    expect(update).toHaveBeenCalledWith({ screenshotCopy: "auto" });
  });

  it("does not touch the save preference when toggled", async () => {
    const update = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    window.electronAPI.getSettings = vi
      .fn()
      .mockResolvedValue({ ...DEFAULT_SETTINGS, screenshotSave: "manual" });
    window.electronAPI.updateSettings = update;
    render(<ScreenshotCopySettings />);

    fireEvent.click(await screen.findByRole("switch"));
    expect(update).toHaveBeenCalledWith({ screenshotCopy: "manual" });
  });
});
