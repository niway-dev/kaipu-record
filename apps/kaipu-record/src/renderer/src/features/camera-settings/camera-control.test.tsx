import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CameraPanelDrawer, CameraPanelTile, useCameraControl } from "./camera-control";

const original = { ...window.electronAPI };
afterEach(() => {
  Object.assign(window.electronAPI, original);
});

/** The Record page's shape: the full-size tile and the wide drawer. */
function PageHarness({
  on = true,
  isRecording = false,
}: {
  on?: boolean;
  isRecording?: boolean;
}): React.JSX.Element {
  const control = useCameraControl();
  return (
    <div>
      <CameraPanelTile compact={false} control={control} on={on} onToggle={() => {}} />
      <CameraPanelDrawer variant="page" control={control} on={on} isRecording={isRecording} />
    </div>
  );
}

/** The Capture page's setup row: the Camera card and its two-column panel. */
function CardHarness({
  on = true,
  onToggle = () => {},
}: {
  on?: boolean;
  onToggle?: () => void;
}): React.JSX.Element {
  const control = useCameraControl();
  return (
    <div>
      <CameraPanelTile card compact={false} control={control} on={on} onToggle={onToggle} />
      <CameraPanelDrawer variant="page" control={control} on={on} isRecording={false} />
    </div>
  );
}

function PanelHarness({ isRecording = false }: { isRecording?: boolean }): React.JSX.Element {
  const control = useCameraControl();
  return (
    <div>
      <CameraPanelTile control={control} on onToggle={() => {}} />
      <CameraPanelDrawer control={control} on isRecording={isRecording} />
      <button type="button">Start Recording</button>
    </div>
  );
}

describe("Camera drawer (Record page, page variant)", () => {
  it("opens a drawer with focus on the chosen camera, and Esc returns focus to the chevron", async () => {
    render(<PageHarness />);
    const chevron = screen.getByRole("button", { name: "Camera settings" });
    await userEvent.click(chevron);

    const drawer = screen.getByRole("region", { name: "Camera settings" });
    expect(chevron).toHaveAttribute("aria-controls", drawer.id);
    expect(screen.getByRole("radio", { name: "Default camera" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(chevron).toHaveFocus();
    expect(chevron).toHaveAttribute("aria-expanded", "false");
  });

  it("persists a change through the settings IPC", async () => {
    const updateSettings = vi.fn(async () => ({}) as never);
    window.electronAPI.updateSettings = updateSettings;
    render(<PageHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Camera settings" }));
    await userEvent.click(screen.getByRole("radio", { name: "Square" }));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        cameraBubble: {
          shape: "rounded",
          cornerRadius: 0.18,
          size: 240,
          deviceId: null,
          mirrored: true,
          framing: { enabled: false, zoom: 1, x: 0, y: 0 },
        },
      }),
    );
  });

  it("replaces the settings with the blocked card while access is denied", async () => {
    window.electronAPI.getCameraAccessStatus = async () => "blocked";
    const openSystemSettings = vi.fn(async () => {});
    window.electronAPI.openSystemSettings = openSystemSettings;
    render(<PageHarness on={false} />);
    await screen.findByText("BLOCKED");

    await userEvent.click(screen.getByRole("button", { name: "Camera settings" }));
    const button = screen.getByRole("button", { name: "Open System Settings" });
    expect(button).toHaveFocus();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(openSystemSettings).toHaveBeenCalledWith("camera");
  });
});

describe("Camera drawer (capture panel)", () => {
  it("expands inline, keeps the Tab order inside the panel, and closes on Esc", async () => {
    render(<PanelHarness />);
    const chevron = screen.getByRole("button", { name: "Camera settings" });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();

    await userEvent.click(chevron);
    const drawer = screen.getByRole("region", { name: "Camera settings" });
    expect(drawer).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Circle" })).toHaveFocus();
    // Compact chips, short labels: the Custom chip never shows the long "Custom · N px".
    expect(screen.queryByText(/Custom ·/)).not.toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(chevron).toHaveFocus();
  });

  it("closes from the chevron", async () => {
    render(<PanelHarness />);
    const chevron = screen.getByRole("button", { name: "Camera settings" });
    await userEvent.click(chevron);
    await userEvent.click(chevron);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("shows the live note during a recording", async () => {
    render(<PanelHarness isRecording />);
    await userEvent.click(screen.getByRole("button", { name: "Camera settings" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Changes apply live and will show in the recording.",
    );
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
            cameraBubble: {
              shape: "rounded",
              cornerRadius: 0.18,
              size: 240,
              deviceId: "cam-9",
              mirrored: true,
              framing: { enabled: false, zoom: 1, x: 0, y: 0 },
            },
          });
      });
    const updateSettings = vi.fn(async () => ({}) as never);
    window.electronAPI.updateSettings = updateSettings;
    render(<PageHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Camera settings" }));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "300" } });
    // Nothing written while the saved value is unknown.
    expect(updateSettings).not.toHaveBeenCalled();

    await act(async () => release!());
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        cameraBubble: {
          shape: "rounded",
          cornerRadius: 0.18,
          size: 300,
          deviceId: "cam-9",
          mirrored: true,
          framing: { enabled: false, zoom: 1, x: 0, y: 0 },
        },
      }),
    );
  });
});

describe("useCameraSettings throttling", () => {
  it("sends a burst of slider changes as few writes, ending on the last value", async () => {
    vi.useFakeTimers();
    try {
      const updateSettings = vi.fn(async () => ({}) as never);
      window.electronAPI.updateSettings = updateSettings;
      render(<PageHarness />);
      fireEvent.click(screen.getByRole("button", { name: "Camera settings" }));
      const slider = screen.getByRole("slider");
      for (const value of ["250", "260", "270", "280"]) {
        fireEvent.change(slider, { target: { value } });
      }
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(updateSettings.mock.calls.length).toBeLessThanOrEqual(2);
      expect(updateSettings).toHaveBeenLastCalledWith({
        cameraBubble: {
          shape: "circle",
          cornerRadius: 0.18,
          size: 280,
          deviceId: null,
          mirrored: true,
          framing: { enabled: false, zoom: 1, x: 0, y: 0 },
        },
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
      const { unmount } = render(<PageHarness />);
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.click(screen.getByRole("button", { name: "Camera settings" }));
      const slider = screen.getByRole("slider");
      fireEvent.change(slider, { target: { value: "250" } });
      // Within the throttle window: the second value is still waiting on the timer.
      fireEvent.change(slider, { target: { value: "300" } });
      unmount();
      expect(updateSettings).toHaveBeenLastCalledWith({
        cameraBubble: {
          shape: "circle",
          cornerRadius: 0.18,
          size: 300,
          deviceId: null,
          mirrored: true,
          framing: { enabled: false, zoom: 1, x: 0, y: 0 },
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("window blur", () => {
  it("closes an open camera drawer when the window loses focus", async () => {
    render(<PageHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Camera settings" }));
    expect(screen.getByRole("region", { name: "Camera settings" })).toBeInTheDocument();
    act(() => {
      fireEvent.blur(window);
    });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});

describe("Camera card (Capture page)", () => {
  it("shows the camera, shape and size, and flips the camera from its switch", async () => {
    const onToggle = vi.fn();
    render(<CardHarness onToggle={onToggle} />);
    expect(await screen.findByText("Default camera · circle, M")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Camera" }));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("opens the two-column panel from its chevron and picks a camera through the same setting", async () => {
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
      await userEvent.click(screen.getByRole("button", { name: "Camera settings" }));
      await userEvent.click(await screen.findByRole("radio", { name: "FaceTime HD Camera" }));
      await waitFor(() =>
        expect(updateSettings).toHaveBeenCalledWith({
          cameraBubble: expect.objectContaining({ deviceId: "cam-2" }),
        }),
      );
      expect(await screen.findByText("FaceTime HD Camera · circle, M")).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { value: media, configurable: true });
    }
  });
});
