import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "./update-banner";

describe("UpdateBanner", () => {
  it("renders the version and installs on click", () => {
    const install = vi.fn();
    window.electronAPI.installUpdate = install;
    render(<UpdateBanner version="2.0.0" />);
    expect(screen.getByText(/2\.0\.0/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /restart/i }));
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("can be dismissed", () => {
    render(<UpdateBanner version="2.0.0" />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByText(/2\.0\.0/)).toBeNull();
  });
});
