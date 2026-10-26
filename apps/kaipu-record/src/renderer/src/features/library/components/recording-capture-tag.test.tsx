import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecordingCaptureTag } from "./recording-capture-tag";

describe("RecordingCaptureTag", () => {
  it("renders nothing without capture metadata", () => {
    const { container } = render(<RecordingCaptureTag capture={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels a framed recording by its ratio", () => {
    render(
      <RecordingCaptureTag capture={{ mode: "area", width: 1280, height: 720, ratio: "16:9" }} />,
    );
    expect(screen.getByText("FRAME · 16:9")).toBeInTheDocument();
  });

  it("labels a free frame by its output size", () => {
    render(
      <RecordingCaptureTag capture={{ mode: "area", width: 1234, height: 567, ratio: "free" }} />,
    );
    expect(screen.getByText("FRAME · 1234 × 567")).toBeInTheDocument();
  });

  it("labels screen and window recordings", () => {
    render(
      <>
        <RecordingCaptureTag capture={{ mode: "screen", width: 1662, height: 1080, ratio: null }} />
        <RecordingCaptureTag capture={{ mode: "window", width: 800, height: 600, ratio: null }} />
      </>,
    );
    expect(screen.getByText("SCREEN")).toHaveAttribute("data-mode", "screen");
    expect(screen.getByText("WINDOW")).toHaveAttribute("data-mode", "window");
  });
});
