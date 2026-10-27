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

describe("CameraBubble — drag to move", () => {
  it("moves the bubble by the pointer's offset from the press, during a recording too", () => {
    withStream();
    let push: ((activity: RecordingActivity) => void) | null = null;
    window.electronAPI.onRecordingState = (callback) => {
      push = callback;
      return () => {};
    };
    const begin = vi.fn();
    const moveBy = vi.fn();
    window.electronAPI.beginCameraBubbleMove = begin;
    window.electronAPI.moveCameraBubble = moveBy;
    render(<CameraBubble />);
    act(() => push?.({ active: true, status: "recording", elapsedSeconds: 0 }));
    const bubble = screen.getByTestId("camera-bubble");

    fireEvent.pointerDown(bubble, { button: 0, screenX: 100, screenY: 100, pointerId: 1 });
    expect(begin).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(bubble, { screenX: 130, screenY: 90, pointerId: 1 });
    fireEvent.pointerMove(bubble, { screenX: 160, screenY: 70, pointerId: 1 });
    expect(moveBy).toHaveBeenNthCalledWith(1, 30, -10);
    expect(moveBy).toHaveBeenNthCalledWith(2, 60, -30);

    fireEvent.pointerUp(bubble, { pointerId: 1 });
    fireEvent.pointerMove(bubble, { screenX: 400, screenY: 400, pointerId: 1 });
    expect(moveBy).toHaveBeenCalledTimes(2);
  });

  it("does not move on a secondary button, nor while the grip resizes", () => {
    withStream();
    const moveBy = vi.fn();
    window.electronAPI.moveCameraBubble = moveBy;
    const { container } = render(<CameraBubble />);
    const bubble = screen.getByTestId("camera-bubble");
    fireEvent.pointerDown(bubble, { button: 2, screenX: 100, screenY: 100, pointerId: 1 });
    fireEvent.pointerMove(bubble, { screenX: 150, screenY: 150, pointerId: 1 });

    fireEvent.pointerEnter(container.firstElementChild!);
    const grip = screen.getByTestId("bubble-resize-grip");
    fireEvent.pointerDown(grip, { button: 0, screenX: 100, screenY: 100, pointerId: 2 });
    fireEvent.pointerMove(grip, { screenX: 140, screenY: 60, pointerId: 2 });
    fireEvent.pointerUp(grip, { pointerId: 2 });
    expect(moveBy).not.toHaveBeenCalled();
  });
});

describe("CameraBubble — grip release races", () => {
  it("waits for a preview that lands after release, sends the queued size, and saves its result", async () => {
    withStream();
    const resolvers: Array<(applied: number) => void> = [];
    const preview = vi.fn(
      (_size: number) => new Promise<number>((resolve) => resolvers.push(resolve)),
    );
    const updateSettings = vi.fn(async () => ({}) as never);
    window.electronAPI.previewCameraBubbleSize = preview;
    window.electronAPI.updateSettings = updateSettings;
    const { container } = render(<CameraBubble />);
    fireEvent.pointerEnter(container.firstElementChild!);
    const grip = screen.getByTestId("bubble-resize-grip");

    fireEvent.pointerDown(grip, { screenX: 100, screenY: 100, pointerId: 1 });
    fireEvent.pointerMove(grip, { screenX: 120, screenY: 80, pointerId: 1 });
    fireEvent.pointerMove(grip, { screenX: 140, screenY: 60, pointerId: 1 });
    fireEvent.pointerUp(grip, { pointerId: 1 });
    // Released before main answered: nothing saved yet.
    expect(updateSettings).not.toHaveBeenCalled();

    await act(async () => resolvers[0]!(250));
    // The queued second move goes out after the first reply…
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    await act(async () => resolvers[1]!(300));
    // …and its applied size is what gets saved.
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        cameraBubble: { shape: "circle", size: 300, deviceId: null },
      }),
    );
    expect(updateSettings).toHaveBeenCalledTimes(1);
  });

  it("a recording that starts mid-drag saves the size the drag reached", async () => {
    withStream();
    let push: ((activity: RecordingActivity) => void) | null = null;
    window.electronAPI.onRecordingState = (callback) => {
      push = callback;
      return () => {};
    };
    const updateSettings = vi.fn(async () => ({}) as never);
    window.electronAPI.previewCameraBubbleSize = vi.fn(async () => 280);
    window.electronAPI.updateSettings = updateSettings;
    const { container } = render(<CameraBubble />);
    fireEvent.pointerEnter(container.firstElementChild!);
    const grip = screen.getByTestId("bubble-resize-grip");
    fireEvent.pointerDown(grip, { screenX: 100, screenY: 100, pointerId: 1 });
    fireEvent.pointerMove(grip, { screenX: 140, screenY: 60, pointerId: 1 });

    act(() => push?.({ active: true, status: "recording", elapsedSeconds: 0 }));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        cameraBubble: { shape: "circle", size: 280, deviceId: null },
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
