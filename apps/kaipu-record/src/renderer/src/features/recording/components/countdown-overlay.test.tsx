import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CountdownOverlay } from "./countdown-overlay";

describe("CountdownOverlay", () => {
  it("shows the countdown number", () => {
    render(<CountdownOverlay value={2} onCancel={vi.fn()} />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows a spinner (no number) once the count finishes and streams acquire", () => {
    const { container } = render(<CountdownOverlay value={null} onCancel={vi.fn()} />);
    // The status region is still present (blocking overlay stays up)...
    expect(screen.getByRole("status")).toBeInTheDocument();
    // ...but renders no digit — only the spinner svg.
    expect(screen.queryByText(/^\d$/)).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("cancels via the visible Cancel button", () => {
    const onCancel = vi.fn();
    render(<CountdownOverlay value={2} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("cancels on Escape", () => {
    const onCancel = vi.fn();
    render(<CountdownOverlay value={2} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
