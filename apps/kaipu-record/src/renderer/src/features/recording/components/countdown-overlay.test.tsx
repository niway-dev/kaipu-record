import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CountdownOverlay } from "./countdown-overlay";

describe("CountdownOverlay", () => {
  it("shows the countdown number", () => {
    render(<CountdownOverlay value={2} />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows a spinner (no number) once the count finishes and streams acquire", () => {
    const { container } = render(<CountdownOverlay value={null} />);
    // The status region is still present (blocking overlay stays up)...
    expect(screen.getByRole("status")).toBeInTheDocument();
    // ...but renders no digit — only the spinner svg.
    expect(screen.queryByText(/^\d$/)).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
