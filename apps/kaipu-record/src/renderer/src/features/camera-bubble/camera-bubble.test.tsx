import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { mockPreview } = vi.hoisted(() => ({ mockPreview: vi.fn() }));
vi.mock("@renderer/features/recording/hooks/use-camera-preview", () => ({
  useCameraPreview: mockPreview,
}));

import { CameraBubble } from "./camera-bubble";

describe("CameraBubble", () => {
  it("shows the live video once a stream is present", () => {
    mockPreview.mockReturnValue({ videoRef: { current: null }, hasStream: true });
    const { container } = render(<CameraBubble />);
    const video = container.querySelector("video");
    expect(video).toBeInTheDocument();
    expect(video).toHaveStyle({ display: "block" });
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  it("shows a placeholder icon before the stream is ready", () => {
    mockPreview.mockReturnValue({ videoRef: { current: null }, hasStream: false });
    const { container } = render(<CameraBubble />);
    expect(container.querySelector("video")).toHaveStyle({ display: "none" });
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
