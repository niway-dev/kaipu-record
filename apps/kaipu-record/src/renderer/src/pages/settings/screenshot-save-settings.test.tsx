import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_SETTINGS } from "@shared/types";
import { ScreenshotSaveSettings } from "./screenshot-save-settings";

describe("ScreenshotSaveSettings", () => {
  it("marks the stored mode and writes the other one on click", async () => {
    const update = vi.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, screenshotSave: "manual" });
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    window.electronAPI.updateSettings = update;
    render(<ScreenshotSaveSettings />);

    const auto = await screen.findByRole("button", { name: /automatically/i });
    const manual = screen.getByRole("button", { name: /when i click save/i });
    await waitFor(() => expect(auto).toHaveAttribute("aria-pressed", "true"));
    expect(manual).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(manual);
    expect(update).toHaveBeenCalledWith({ screenshotSave: "manual" });
  });
});
