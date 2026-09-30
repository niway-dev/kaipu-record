import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_SETTINGS } from "@shared/types";
import { BrandBadgeSettings } from "./brand-badge-settings";

describe("BrandBadgeSettings", () => {
  it("is off by default and writes true when switched on", async () => {
    const update = vi.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, showBrandBadge: true });
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    window.electronAPI.updateSettings = update;
    render(<BrandBadgeSettings />);

    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).not.toBeChecked());

    fireEvent.click(toggle);
    expect(update).toHaveBeenCalledWith({ showBrandBadge: true });
  });

  it("reflects a stored on state and writes false when switched off", async () => {
    const update = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    window.electronAPI.getSettings = vi
      .fn()
      .mockResolvedValue({ ...DEFAULT_SETTINGS, showBrandBadge: true });
    window.electronAPI.updateSettings = update;
    render(<BrandBadgeSettings />);

    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).toBeChecked());

    fireEvent.click(toggle);
    expect(update).toHaveBeenCalledWith({ showBrandBadge: false });
  });
});
