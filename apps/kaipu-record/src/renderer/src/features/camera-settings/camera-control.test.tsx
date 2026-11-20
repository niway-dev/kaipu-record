import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CameraBubbleSettings } from "@shared/camera-bubble";
import { CameraPanelPopover, CameraPanelTile, useCameraControl } from "./camera-control";

const original = { ...window.electronAPI };
afterEach(() => {
  Object.assign(window.electronAPI, original);
});

/** The Capture page's setup row: the Camera card and its popover. */
function CardHarness({
  on = true,
  isRecording = false,
  onToggle = () => {},
}: {
  on?: boolean;
  isRecording?: boolean;
  onToggle?: () => void;
}): React.JSX.Element {
  const control = useCameraControl();
  return (
    <div data-testid="row">
      <CameraPanelTile card compact={false} control={control} on={on} onToggle={onToggle} />
      <CameraPanelPopover control={control} on={on} isRecording={isRecording} />
    </div>
  );
}

const DEFAULT_BUBBLE: CameraBubbleSettings = {
  shape: "circle",
  cornerRadius: 0.18,
  size: 240,
  deviceId: null,
  mirrored: true,
  framing: { enabled: false, zoom: 1, x: 0, y: 0 },
};

describe("Camera popover (Capture page)", () => {
  it("opens a popover with focus on the chosen camera, and Esc returns focus to the chevron", async () => {
    render(<CardHarness />);
    const chevron = screen.getByRole("button", { name: /^Camera settings/ });
    await userEvent.click(chevron);

    const popover = screen.getByRole("dialog", { name: "Camera settings" });
    expect(chevron).toHaveAttribute("aria-controls", popover.id);
    expect(chevron).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("radio", { name: "Default camera" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(chevron).toHaveFocus();
    expect(chevron).toHaveAttribute("aria-expanded", "false");
  });

  it("floats over the page: nothing is added to the row's flow", async () => {
    render(<CardHarness />);
    await userEvent.click(screen.getByRole("button", { name: /^Camera settings/ }));
    const popover = screen.getByRole("dialog", { name: "Camera settings" });
    expect(screen.getByTestId("row")).not.toContainElement(popover);
    expect(popover.parentElement).toBe(document.body);
  });

  it("closes from the chevron and on a press outside", async () => {
    render(
      <>
        <CardHarness />
        <button type="button">Elsewhere</button>
      </>,
    );
    const chevron = screen.getByRole("button", { name: /^Camera settings/ });
    await userEvent.click(chevron);
    await userEvent.click(chevron);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(chevron);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("persists a change through the settings IPC, with no Done button", async () => {
    const updateSettings = vi.fn(async () => ({}) as never);
    window.electronAPI.updateSettings = updateSettings;
    render(<CardHarness />);
    await userEvent.click(screen.getByRole("button", { name: /^Camera settings/ }));
    await userEvent.click(screen.getByRole("switch", { name: "Mirror my video" }));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        cameraBubble: { ...DEFAULT_BUBBLE, mirrored: false },
      }),
    );
    expect(screen.queryByRole("button", { name: /done/i })).not.toBeInTheDocument();
  });

  it("replaces the settings with the blocked card while access is denied", async () => {
    window.electronAPI.getCameraAccessStatus = async () => "blocked";
    const openSystemSettings = vi.fn(async () => {});
    window.electronAPI.openSystemSettings = openSystemSettings;
    render(<CardHarness on={false} />);
    await screen.findByText("BLOCKED");

    await userEvent.click(screen.getByRole("button", { name: /^Camera settings/ }));
    const button = screen.getByRole("button", { name: "Open System Settings" });
    expect(button).toHaveFocus();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(openSystemSettings).toHaveBeenCalledWith("camera");
  });

  it("shows the live note during a recording", async () => {
    render(<CardHarness isRecording />);
    await userEvent.click(screen.getByRole("button", { name: /^Camera settings/ }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Changes apply live and will show in the recording.",
    );
  });

  it("closes when the window loses focus", async () => {
    render(<CardHarness />);
    await userEvent.click(screen.getByRole("button", { name: /^Camera settings/ }));
    expect(screen.getByRole("dialog", { name: "Camera settings" })).toBeInTheDocument();
    act(() => {
      fireEvent.blur(window);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("useCameraSettings before the saved value loads", () => {
  it("merges an early change over the saved value, never over the defaults", async () => {
    let release: (() => void) | null = null;
    const saved = await original.getSettings();
    window.electronAPI.getSettings = () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            ...saved,
            cameraBubble: { ...DEFAULT_BUBBLE, deviceId: "cam-9" },
          });
      });
    const updateSettings = vi.fn(async () => ({}) as never);
    window.electronAPI.updateSettings = updateSettings;
    render(<CardHarness />);
    fireEvent.click(screen.getByRole("button", { name: /^Camera settings/ }));
    fireEvent.click(screen.getByRole("switch", { name: "Mirror my video" }));
    // Nothing written while the saved value is unknown.
    expect(updateSettings).not.toHaveBeenCalled();

    await act(async () => release!());
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        cameraBubble: { ...DEFAULT_BUBBLE, deviceId: "cam-9", mirrored: false },
      }),
    );
  });
});

describe("useCameraSettings throttling", () => {
  const framingOn = { enabled: true, zoom: 1, x: 0, y: 0 };

  it("sends a burst of zoom changes as few writes, ending on the last value", async () => {
    vi.useFakeTimers();
    try {
      const updateSettings = vi.fn(async () => ({}) as never);
      window.electronAPI.updateSettings = updateSettings;
      render(<CardHarness />);
      fireEvent.click(screen.getByRole("button", { name: /^Camera settings/ }));
      fireEvent.click(screen.getByRole("switch", { name: "Framing" }));
      const slider = screen.getByRole("slider", { name: "Zoom" });
      for (let step = 0; step < 4; step += 1) fireEvent.keyDown(slider, { key: "ArrowRight" });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(updateSettings.mock.calls.length).toBeLessThanOrEqual(3);
      expect(updateSettings).toHaveBeenLastCalledWith({
        cameraBubble: { ...DEFAULT_BUBBLE, framing: { ...framingOn, zoom: 1.2 } },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes a change still throttled when the control unmounts", async () => {
    vi.useFakeTimers();
    try {
      const updateSettings = vi.fn(async () => ({}) as never);
      window.electronAPI.updateSettings = updateSettings;
      const { unmount } = render(<CardHarness />);
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.click(screen.getByRole("button", { name: /^Camera settings/ }));
      fireEvent.click(screen.getByRole("switch", { name: "Framing" }));
      const slider = screen.getByRole("slider", { name: "Zoom" });
      fireEvent.keyDown(slider, { key: "ArrowRight" });
      // Within the throttle window: the second value is still waiting on the timer.
      fireEvent.keyDown(slider, { key: "ArrowRight" });
      unmount();
      expect(updateSettings).toHaveBeenLastCalledWith({
        cameraBubble: { ...DEFAULT_BUBBLE, framing: { ...framingOn, zoom: 1.1 } },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Camera card (Capture page)", () => {
  it("shows the camera only, and flips the camera from its switch", async () => {
    const onToggle = vi.fn();
    render(<CardHarness onToggle={onToggle} />);
    expect(await screen.findByText("Default camera")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Camera" }));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the popover from its chevron and picks a camera through the same setting", async () => {
    const updateSettings = vi.fn(async () => ({}) as never);
    window.electronAPI.updateSettings = updateSettings;
    const media = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        enumerateDevices: async () => [
          { kind: "videoinput", deviceId: "cam-1", label: "iPhone Camera" },
          { kind: "videoinput", deviceId: "cam-2", label: "FaceTime HD Camera" },
        ],
      },
      configurable: true,
    });
    try {
      render(<CardHarness />);
      await userEvent.click(screen.getByRole("button", { name: /^Camera settings/ }));
      await userEvent.click(await screen.findByRole("radio", { name: "FaceTime HD Camera" }));
      await waitFor(() =>
        expect(updateSettings).toHaveBeenCalledWith({
          cameraBubble: expect.objectContaining({ deviceId: "cam-2" }),
        }),
      );
      // The card's own secondary line (inside its chevron), not the popover's radio row.
      const chevron = screen.getByRole("button", { name: /^Camera settings/ });
      expect(within(chevron).getByText("FaceTime HD Camera")).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { value: media, configurable: true });
    }
  });
});
