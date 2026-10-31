import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingActivity, RecordingSettings } from "@shared/types";

const { mockPreview } = vi.hoisted(() => ({ mockPreview: vi.fn() }));
vi.mock("@renderer/features/recording/hooks/use-camera-preview", () => ({
  useCameraPreview: mockPreview,
}));

import { CameraBubble, gripDragSize } from "./camera-bubble";

const original = { ...window.electronAPI };
// The bubble window exists because the camera is on.
beforeEach(() => {
  window.electronAPI.getRecordingSettings = async () => ({
    ...(await original.getRecordingSettings()),
    isCameraEnabled: true,
  });
});
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
        cameraBubble: {
          shape: "rounded",
          cornerRadius: 0.18,
          size: 240,
          deviceId: "cam-9",
          mirrored: true,
          framing: { enabled: false, zoom: 1, x: 0, y: 0 },
        },
      }) as never;
    const { container } = render(<CameraBubble />);
    await waitFor(() =>
      expect(container.firstElementChild).toHaveAttribute("data-shape", "rounded"),
    );
    expect(mockPreview).toHaveBeenLastCalledWith(true, "cam-9", 720);
  });

  it("centres a 3:4 rectangle in the square window, with the saved corner", async () => {
    withStream();
    window.electronAPI.getSettings = async () =>
      ({
        ...(await original.getSettings()),
        cameraBubble: {
          shape: "rectangle",
          cornerRadius: 0.25,
          size: 240,
          deviceId: null,
          mirrored: true,
          framing: { enabled: false, zoom: 1, x: 0, y: 0 },
        },
      }) as never;
    const { container } = render(<CameraBubble />);
    await waitFor(() =>
      expect(container.firstElementChild).toHaveAttribute("data-shape", "rectangle"),
    );
    // The window's bubble is as tall as the window minus the pads; 3/4 of that wide, centred.
    const height = Math.min(window.innerWidth, window.innerHeight) - 48;
    const width = height * 0.75;
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--inset-x")).toBe(
      `${24 + Math.round((height - width) / 2)}px`,
    );
    expect(screen.getByTestId("camera-bubble")).toHaveStyle({
      borderRadius: `${Math.round(0.25 * width)}px`,
    });
  });

  it("mirrors the preview by default and when the setting is on", async () => {
    withStream();
    const { container } = render(<CameraBubble />);
    await waitFor(() =>
      expect(container.firstElementChild).toHaveAttribute("data-mirrored", "true"),
    );
  });

  it("does not mirror when the setting is off, and follows a live change", async () => {
    withStream();
    let push: ((settings: never) => void) | null = null;
    const base = await original.getSettings();
    window.electronAPI.getSettings = async () =>
      ({
        ...base,
        cameraBubble: {
          shape: "circle",
          cornerRadius: 0.18,
          size: 240,
          deviceId: null,
          mirrored: false,
          framing: { enabled: false, zoom: 1, x: 0, y: 0 },
        },
      }) as never;
    window.electronAPI.onSettingsChanged = ((callback: (settings: never) => void) => {
      push = callback;
      return () => {};
    }) as never;
    const { container } = render(<CameraBubble />);
    await waitFor(() => expect(push).not.toBeNull());
    await waitFor(() => expect(container.firstElementChild).not.toHaveAttribute("data-mirrored"));

    act(() =>
      push?.({
        ...base,
        cameraBubble: {
          shape: "circle",
          cornerRadius: 0.18,
          size: 240,
          deviceId: null,
          mirrored: true,
          framing: { enabled: false, zoom: 1, x: 0, y: 0 },
        },
      } as never),
    );
    expect(container.firstElementChild).toHaveAttribute("data-mirrored", "true");
  });

  async function renderWithFraming(
    framing: { enabled: boolean; zoom: number; x: number; y: number },
    mirrored = true,
  ): Promise<HTMLElement> {
    withStream();
    const base = await original.getSettings();
    window.electronAPI.getSettings = async () =>
      ({
        ...base,
        cameraBubble: {
          shape: "circle",
          size: 240,
          cornerRadius: 0.18,
          deviceId: null,
          mirrored,
          framing,
        },
      }) as never;
    const { container } = render(<CameraBubble />);
    await waitFor(() => expect(mockPreview).toHaveBeenCalled());
    return container.querySelector("video")!;
  }

  it("leaves the video untouched while framing is off", async () => {
    const video = await renderWithFraming({ enabled: false, zoom: 2, x: 1, y: 1 });
    await waitFor(() => expect(mockPreview).toHaveBeenLastCalledWith(true, null, 720));
    expect(video.style.transform).toBe("");
  });

  it("applies the zoom and pan, with the mirror last, while framing is on", async () => {
    const video = await renderWithFraming({ enabled: true, zoom: 2, x: 1, y: 0 });
    await waitFor(() =>
      expect(video.style.transform).toBe("scale(2) translate(-25%, 0%) scaleX(-1)"),
    );
  });

  it("applies framing without the flip when mirroring is off", async () => {
    const video = await renderWithFraming({ enabled: true, zoom: 2, x: -1, y: 1 }, false);
    await waitFor(() => expect(video.style.transform).toBe("scale(2) translate(25%, -25%)"));
  });

  it("asks the camera for more lines when framing zooms in, and follows live changes", async () => {
    let push: ((settings: never) => void) | null = null;
    window.electronAPI.onSettingsChanged = ((callback: (settings: never) => void) => {
      push = callback;
      return () => {};
    }) as never;
    const base = await original.getSettings();
    const video = await renderWithFraming({ enabled: true, zoom: 2, x: 0, y: 0 });
    await waitFor(() => expect(mockPreview).toHaveBeenLastCalledWith(true, null, 1080));
    expect(video.style.transform).toContain("scale(2)");
    // The same bubble follows a pushed change: framing off clears the transform and the
    // camera goes back to its usual lines: 720, what the recorder's webcam track needs from
    // the camera both windows share (ADR 0037).
    act(() =>
      push?.({
        ...base,
        cameraBubble: {
          shape: "circle",
          cornerRadius: 0.18,
          size: 240,
          deviceId: null,
          mirrored: true,
          framing: { enabled: false, zoom: 1, x: 0, y: 0 },
        },
      } as never),
    );
    expect(video.style.transform).toBe("");
    expect(mockPreview).toHaveBeenLastCalledWith(true, null, 720);
  });

  it("keeps the camera resolution while recording, so a zoom change never reopens the camera mid-take", async () => {
    let pushActivity: ((activity: RecordingActivity) => void) | null = null;
    window.electronAPI.onRecordingState = (callback) => {
      pushActivity = callback;
      return () => {};
    };
    let pushSettings: ((settings: never) => void) | null = null;
    window.electronAPI.onSettingsChanged = ((callback: (settings: never) => void) => {
      pushSettings = callback;
      return () => {};
    }) as never;
    const base = await original.getSettings();
    const withZoom = (zoom: number): never =>
      ({
        ...base,
        cameraBubble: {
          shape: "circle",
          cornerRadius: 0.18,
          size: 240,
          deviceId: null,
          mirrored: true,
          framing: { enabled: true, zoom, x: 0, y: 0 },
        },
      }) as never;
    const video = await renderWithFraming({ enabled: true, zoom: 1, x: 0, y: 0 });
    await waitFor(() => expect(mockPreview).toHaveBeenLastCalledWith(true, null, 720));
    act(() => pushActivity?.({ active: true, status: "recording", elapsedSeconds: 0 }));
    act(() => pushSettings?.(withZoom(2)));
    // The zoom applies at once; the stream keeps its lines until the take ends.
    expect(video.style.transform).toContain("scale(2)");
    expect(mockPreview).toHaveBeenLastCalledWith(true, null, 720);
    act(() => pushActivity?.({ active: false, status: "recording", elapsedSeconds: 3 }));
    expect(mockPreview).toHaveBeenLastCalledWith(true, null, 1080);
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

  it("drops the chrome as soon as a take is pending, before the capture starts", () => {
    withStream();
    let push: ((activity: RecordingActivity) => void) | null = null;
    window.electronAPI.onRecordingState = (callback) => {
      push = callback;
      return () => {};
    };
    const { container } = render(<CameraBubble />);
    fireEvent.pointerEnter(container.firstElementChild!);
    expect(screen.getByTestId("bubble-resize-grip")).toBeInTheDocument();

    // Countdown or stream acquisition: not active yet, but the capture is about to start.
    act(() => push?.({ active: false, pending: true, status: "recording", elapsedSeconds: 0 }));
    expect(container.firstElementChild).not.toHaveAttribute("data-chrome");
    expect(screen.queryByTestId("bubble-resize-grip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bubble-camera-off")).not.toBeInTheDocument();

    // A cancelled countdown gives the chrome back to the pointer still on the bubble.
    act(() => push?.({ active: false, status: "recording", elapsedSeconds: 0 }));
    expect(screen.getByTestId("bubble-resize-grip")).toBeInTheDocument();
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
        cameraBubble: {
          shape: "circle",
          cornerRadius: 0.18,
          size: 300,
          deviceId: null,
          mirrored: true,
          framing: { enabled: false, zoom: 1, x: 0, y: 0 },
        },
      }),
    );
  });
});

describe("CameraBubble — turn the camera off", () => {
  it("offers a close button on hover that turns the camera off", () => {
    withStream();
    const update = vi.fn();
    window.electronAPI.updateRecordingSettings = update;
    const { container } = render(<CameraBubble />);
    expect(screen.queryByTestId("bubble-camera-off")).not.toBeInTheDocument();
    fireEvent.pointerEnter(container.firstElementChild!);
    const close = screen.getByRole("button", { name: "Turn camera off" });
    fireEvent.click(close);
    expect(update).toHaveBeenCalledWith({ isCameraEnabled: false });
  });

  it("never draws the close button during a recording", () => {
    withStream();
    let push: ((activity: RecordingActivity) => void) | null = null;
    window.electronAPI.onRecordingState = (callback) => {
      push = callback;
      return () => {};
    };
    const { container } = render(<CameraBubble />);
    act(() => push?.({ active: true, status: "recording", elapsedSeconds: 0 }));
    fireEvent.pointerEnter(container.firstElementChild!);
    expect(screen.queryByTestId("bubble-camera-off")).not.toBeInTheDocument();
  });

  it("does not start a move from the close button", () => {
    withStream();
    const begin = vi.fn();
    window.electronAPI.beginCameraBubbleMove = begin;
    const { container } = render(<CameraBubble />);
    fireEvent.pointerEnter(container.firstElementChild!);
    fireEvent.pointerDown(screen.getByTestId("bubble-camera-off"), { button: 0, pointerId: 1 });
    expect(begin).not.toHaveBeenCalled();
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
        cameraBubble: {
          shape: "circle",
          cornerRadius: 0.18,
          size: 300,
          deviceId: null,
          mirrored: true,
          framing: { enabled: false, zoom: 1, x: 0, y: 0 },
        },
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
        cameraBubble: {
          shape: "circle",
          cornerRadius: 0.18,
          size: 280,
          deviceId: null,
          mirrored: true,
          framing: { enabled: false, zoom: 1, x: 0, y: 0 },
        },
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

/**
 * A camera turned off mid-take parks the bubble window (main hides it, ADR 0037): the preview
 * must release the camera itself then, so the in-use light goes off, and reopen it when the
 * camera comes back on.
 */
describe("CameraBubble — the Camera toggle", () => {
  it("releases the camera while the toggle is off and reopens it when it is on again", async () => {
    withStream();
    let broadcast: ((settings: RecordingSettings) => void) | null = null;
    window.electronAPI.onRecordingSettingsChanged = (callback) => {
      broadcast = callback;
      return () => {};
    };
    render(<CameraBubble />);
    await waitFor(() => expect(broadcast).not.toBeNull());
    expect(mockPreview).toHaveBeenLastCalledWith(true, null, 720);
    const base = await original.getRecordingSettings();
    act(() => broadcast!({ ...base, isCameraEnabled: false }));
    expect(mockPreview).toHaveBeenLastCalledWith(false, null, 720);
    act(() => broadcast!({ ...base, isCameraEnabled: true }));
    expect(mockPreview).toHaveBeenLastCalledWith(true, null, 720);
  });

  it("never opens the camera of a window parked before it read the toggle", async () => {
    // Parked before ready-to-show: opening the camera until main answers would blink its light.
    mockPreview.mockClear();
    withStream();
    let answer!: (settings: RecordingSettings) => void;
    window.electronAPI.getRecordingSettings = () => new Promise((resolve) => (answer = resolve));
    render(<CameraBubble />);
    const base = await original.getRecordingSettings();
    await act(async () => answer({ ...base, isCameraEnabled: false }));
    expect(mockPreview).toHaveBeenCalled();
    expect(mockPreview.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
  });

  it("opens the camera when main cannot say whether it is on: the window exists for it", async () => {
    withStream();
    window.electronAPI.getRecordingSettings = () => Promise.reject(new Error("no ipc"));
    render(<CameraBubble />);
    await waitFor(() => expect(mockPreview).toHaveBeenLastCalledWith(true, null, 720));
  });

  it("a broadcast that lands before the first read wins over it", async () => {
    withStream();
    let answer!: (settings: RecordingSettings) => void;
    window.electronAPI.getRecordingSettings = () => new Promise((resolve) => (answer = resolve));
    let broadcast: ((settings: RecordingSettings) => void) | null = null;
    window.electronAPI.onRecordingSettingsChanged = (callback) => {
      broadcast = callback;
      return () => {};
    };
    render(<CameraBubble />);
    const base = await original.getRecordingSettings();
    act(() => broadcast!({ ...base, isCameraEnabled: false }));
    await act(async () => answer({ ...base, isCameraEnabled: true }));
    expect(mockPreview).toHaveBeenLastCalledWith(false, null, 720);
  });
});

/**
 * The bubble window is part of the recorded screen, so whatever it paints at rest is in every
 * video. jsdom applies no stylesheet, so this reads the real one: the bubble itself carries no
 * border or outline, and the accent outline exists only under the hover-chrome selector.
 */
describe("camera bubble stylesheet", () => {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const css = readFileSync(path.join(dir, "camera-bubble.module.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const rule = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    expect(start, `${selector} rule`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start));
  };

  it("draws no border or outline on the bubble at rest", () => {
    expect(rule(".bubble")).not.toMatch(/\b(border|outline)\s*:/);
  });

  it("draws the accent outline only while the hover chrome is on", () => {
    expect(rule(".root[data-chrome] .bubble")).toMatch(
      /outline:\s*2px solid var\(--accent-primary\)/,
    );
  });
});
