import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordingActivity } from "@shared/types";

const { mockPreview } = vi.hoisted(() => ({ mockPreview: vi.fn() }));
vi.mock("@renderer/features/recording/hooks/use-camera-preview", () => ({
  useCameraPreview: mockPreview,
}));

import { CameraBubble, gripDragSize } from "./camera-bubble";

const original = { ...window.electronAPI };
afterEach(() => {
  Object.assign(window.electronAPI, original);
});

function withStream(): void {
  mockPreview.mockReturnValue({ videoRef: { current: null }, hasStream: true });
}

describe("CameraBubble", () => {
  it("shows the live video once a stream is present", () => {
    withStream();
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

  it("opens the persisted camera and takes the persisted shape", async () => {
    withStream();
    window.electronAPI.getSettings = async () =>
      ({
        ...(await original.getSettings()),
        cameraBubble: { shape: "rounded", size: 240, deviceId: "cam-9" },
      }) as never;
    const { container } = render(<CameraBubble />);
    await waitFor(() =>
      expect(container.firstElementChild).toHaveAttribute("data-shape", "rounded"),
    );
    expect(mockPreview).toHaveBeenLastCalledWith(true, "cam-9");
  });

  it("shows the outline, size label and grip on hover", () => {
    withStream();
    const { container } = render(<CameraBubble />);
    fireEvent.pointerEnter(container.firstElementChild!);
    expect(container.firstElementChild).toHaveAttribute("data-chrome", "true");
    expect(screen.getByTestId("bubble-size-label")).toBeInTheDocument();
    expect(screen.getByTestId("bubble-resize-grip")).toBeInTheDocument();
    fireEvent.pointerLeave(container.firstElementChild!);
    expect(screen.queryByTestId("bubble-resize-grip")).not.toBeInTheDocument();
  });

  it("never shows the chrome once a recording has started", async () => {
    withStream();
    let push: ((activity: RecordingActivity) => void) | null = null;
    window.electronAPI.onRecordingState = (callback) => {
      push = callback;
      return () => {};
    };
    const { container } = render(<CameraBubble />);
    fireEvent.pointerEnter(container.firstElementChild!);
    expect(screen.getByTestId("bubble-resize-grip")).toBeInTheDocument();

    act(() => push?.({ active: true, status: "recording", elapsedSeconds: 0 }));
    expect(screen.queryByTestId("bubble-resize-grip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bubble-size-label")).not.toBeInTheDocument();
    expect(container.firstElementChild).not.toHaveAttribute("data-chrome");

    // Hovering again mid-take changes nothing.
    fireEvent.pointerLeave(container.firstElementChild!);
    fireEvent.pointerEnter(container.firstElementChild!);
    expect(screen.queryByTestId("bubble-resize-grip")).not.toBeInTheDocument();
  });

  it("previews a grip drag through main and persists the applied size on release", async () => {
    withStream();
    const preview = vi.fn(async (size: number) => Math.min(size, 300));
    const updateSettings = vi.fn(async () => ({}) as never);
    window.electronAPI.previewCameraBubbleSize = preview;
    window.electronAPI.updateSettings = updateSettings;
    const { container } = render(<CameraBubble />);
    fireEvent.pointerEnter(container.firstElementChild!);
    const grip = screen.getByTestId("bubble-resize-grip");

    // jsdom's window is 1024×768 → a 720 px "bubble"; the projection is what matters.
    fireEvent.pointerDown(grip, { screenX: 100, screenY: 100, pointerId: 1 });
    fireEvent.pointerMove(grip, { screenX: 300, screenY: -100, pointerId: 1 });
    await waitFor(() => expect(preview).toHaveBeenCalled());
    fireEvent.pointerUp(grip, { pointerId: 1 });
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        cameraBubble: { shape: "circle", size: 300, deviceId: null },
      }),
    );
  });
});

describe("gripDragSize", () => {
  it("projects the pointer onto the up-right diagonal", () => {
    expect(gripDragSize(240, 40, -40)).toBe(280);
    expect(gripDragSize(240, 40, 0)).toBe(260);
    expect(gripDragSize(240, -60, 60)).toBe(180);
  });

  it("clamps to 120–480", () => {
    expect(gripDragSize(240, 1000, -1000)).toBe(480);
    expect(gripDragSize(240, -1000, 1000)).toBe(120);
  });
});
