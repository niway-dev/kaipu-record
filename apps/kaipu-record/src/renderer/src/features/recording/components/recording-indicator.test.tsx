import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecordingIndicator } from "./recording-indicator";

describe("RecordingIndicator", () => {
  it("labels an active recording and formats the elapsed time", () => {
    render(<RecordingIndicator variant="bar" paused={false} elapsedSeconds={90} />);
    expect(screen.getByText("Recording")).toBeInTheDocument();
    expect(screen.getByText("00:01:30")).toBeInTheDocument();
  });

  it("switches the label to Paused when paused", () => {
    render(<RecordingIndicator variant="banner" paused elapsedSeconds={0} />);
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("00:00:00")).toBeInTheDocument();
  });

  it("marks the status dot as paused so it can stop pulsing", () => {
    const { container } = render(<RecordingIndicator variant="bar" paused elapsedSeconds={5} />);
    const dot = container.querySelector("[data-paused]");
    expect(dot).not.toBeNull();
  });
});
