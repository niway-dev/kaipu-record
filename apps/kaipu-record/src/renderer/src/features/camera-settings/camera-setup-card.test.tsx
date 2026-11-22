import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_CAMERA_BUBBLE, type CameraBubbleSettings } from "@shared/camera-bubble";
import { CameraSetupCard } from "./camera-setup-card";

const cameras = [
  { deviceId: "cam-1", label: "iPhone Camera" },
  { deviceId: "cam-2", label: "" },
];
const base = {
  bubble: DEFAULT_CAMERA_BUBBLE,
  cameras,
  on: true,
  onToggle: vi.fn(),
  open: false,
  onOpenChange: vi.fn(),
};
const withBubble = (patch: Partial<CameraBubbleSettings>): CameraBubbleSettings => ({
  ...DEFAULT_CAMERA_BUBBLE,
  ...patch,
});

describe("CameraSetupCard secondary line", () => {
  it("names the default camera and nothing about shape or size", () => {
    render(<CameraSetupCard {...base} />);
    expect(screen.getByText("Camera")).toBeInTheDocument();
    expect(screen.getByText("Default camera")).toBeInTheDocument();
  });

  it("names the chosen camera, whatever the stored shape and size", () => {
    render(
      <CameraSetupCard
        {...base}
        bubble={withBubble({ deviceId: "cam-1", shape: "rounded", size: 360 })}
      />,
    );
    expect(screen.getByText("iPhone Camera")).toBeInTheDocument();
    expect(screen.queryByText(/square|circle|rectangle|px/i)).not.toBeInTheDocument();
  });

  it("numbers an unnamed camera, and a remembered one that is unplugged", () => {
    const { rerender } = render(
      <CameraSetupCard {...base} bubble={withBubble({ deviceId: "cam-2" })} />,
    );
    expect(screen.getByText("Camera 2")).toBeInTheDocument();
    rerender(<CameraSetupCard {...base} bubble={withBubble({ deviceId: "gone" })} />);
    expect(screen.getByText("Camera 3")).toBeInTheDocument();
  });

  it("is what its popover is placed against", () => {
    const { container } = render(<CameraSetupCard {...base} />);
    expect(container.querySelector("[data-settings-anchor]")).toBeInTheDocument();
  });
});

describe("CameraSetupCard controls", () => {
  it("flips the camera from the switch", async () => {
    const onToggle = vi.fn();
    render(<CameraSetupCard {...base} on={false} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: "Camera" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("OFF")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("opens the panel from the chevron", async () => {
    const onOpenChange = vi.fn();
    render(<CameraSetupCard {...base} onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole("button", { name: /^Camera settings/ }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("reads BLOCKED and cannot turn the camera on while access is denied", async () => {
    const onToggle = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <CameraSetupCard
        {...base}
        on={false}
        blocked
        onToggle={onToggle}
        onOpenChange={onOpenChange}
      />,
    );
    const toggle = screen.getByRole("switch", { name: "Camera, blocked" });
    expect(screen.getByText("BLOCKED")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
    // The chevron still works: it is where the way out (System Settings) lives.
    await userEvent.click(screen.getByRole("button", { name: /^Camera settings/ }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
