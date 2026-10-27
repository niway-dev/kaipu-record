import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_SETTINGS } from "@shared/types";
import { CountdownSettings } from "./countdown-settings";

describe("CountdownSettings", () => {
  it("offers off, 3 and 5 seconds and checks 3 by default", async () => {
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    render(<CountdownSettings />);

    const options = await screen.findAllByRole("radio");
    expect(options.map((option) => option.textContent)).toEqual(["Off", "3 s", "5 s"]);
    await waitFor(() => expect(screen.getByRole("radio", { name: "3 s" })).toBeChecked());
  });

  it("reflects a stored length", async () => {
    window.electronAPI.getSettings = vi
      .fn()
      .mockResolvedValue({ ...DEFAULT_SETTINGS, recordingCountdownSeconds: 0 });
    render(<CountdownSettings />);

    await waitFor(() => expect(screen.getByRole("radio", { name: "Off" })).toBeChecked());
    expect(screen.getByRole("radio", { name: "3 s" })).not.toBeChecked();
  });

  it.each([
    ["Off", 0],
    ["5 s", 5],
  ])("writes %s as %i seconds", async (label, seconds) => {
    const update = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    window.electronAPI.updateSettings = update;
    render(<CountdownSettings />);

    fireEvent.click(await screen.findByRole("radio", { name: label }));

    expect(update).toHaveBeenCalledWith({ recordingCountdownSeconds: seconds });
  });
});
