import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportQualitySettings } from "./export-quality-settings";

describe("ExportQualitySettings", () => {
  it("checks the current quality and shows its caption", () => {
    render(<ExportQualitySettings quality="balanced" onChange={vi.fn()} />);

    expect(screen.getByRole("radio", { name: /Balanced 1080p/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /Maximum quality/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByText(/about half the size/)).toBeInTheDocument();
  });

  it("writes the picked quality", () => {
    const onChange = vi.fn();
    render(<ExportQualitySettings quality="balanced" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /Maximum quality/ }));

    expect(onChange).toHaveBeenCalledWith("maximum");
  });

  it("shows the Maximum caption when Maximum is the default", () => {
    render(<ExportQualitySettings quality="maximum" onChange={vi.fn()} />);

    expect(screen.getByText(/Native size and the highest bitrate/)).toBeInTheDocument();
  });
});
