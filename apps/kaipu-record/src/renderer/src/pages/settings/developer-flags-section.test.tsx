import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FLAG_NAMES } from "@shared/analytics";
import { DeveloperFlagsSection } from "./developer-flags-section";

describe("DeveloperFlagsSection", () => {
  const api = window.electronAPI as unknown as {
    flagOverrides: unknown;
    setFlagOverride: unknown;
  };
  const original = { ...api };
  afterEach(() => {
    api.flagOverrides = original.flagOverrides;
    api.setFlagOverride = original.setFlagOverride;
  });

  it("lists one toggle per flag with its source", () => {
    render(<DeveloperFlagsSection />);
    for (const name of FLAG_NAMES) {
      expect(screen.getByRole("switch", { name })).toBeInTheDocument();
    }
    expect(screen.getAllByText(/default \(PostHog not loaded/)).toHaveLength(FLAG_NAMES.length);
  });

  it("toggling asks main to pin the flag to the new value", () => {
    const set = vi.fn(async () => ({}));
    api.setFlagOverride = set;
    render(<DeveloperFlagsSection />);
    const toggle = screen.getByRole("switch", { name: "image-canvas" });
    expect(toggle).not.toBeChecked(); // default off
    fireEvent.click(toggle);
    expect(set).toHaveBeenCalledWith("image-canvas", true);
  });

  it("a pinned flag says so and Reset clears just that flag", () => {
    const set = vi.fn(async () => ({}));
    api.setFlagOverride = set;
    api.flagOverrides = { "image-canvas": true };
    render(<DeveloperFlagsSection />);
    expect(screen.getByText("On · pinned here")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Reset" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(set).toHaveBeenCalledWith("image-canvas", null);
  });
});
