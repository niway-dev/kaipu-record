import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CameraToggleSplit } from "./camera-toggle-split";

const base = { on: false, onToggle: vi.fn(), open: false, onOpenChange: vi.fn() };

describe("CameraToggleSplit", () => {
  it("toggles the camera from the body, as the plain tile did", async () => {
    const onToggle = vi.fn();
    render(<CameraToggleSplit {...base} onToggle={onToggle} />);
    expect(screen.getByText("Camera")).toBeInTheDocument();
    expect(screen.getByText("OFF")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { pressed: false }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("opens and closes the settings from its own chevron", async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<CameraToggleSplit {...base} onOpenChange={onOpenChange} />);
    const chevron = screen.getByRole("button", { name: "Camera settings" });
    expect(chevron).toHaveAttribute("aria-haspopup", "dialog");
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(chevron);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    rerender(<CameraToggleSplit {...base} open onOpenChange={onOpenChange} />);
    expect(chevron).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(chevron);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("drops the label and the dialog popup in the compact (panel) variant", () => {
    render(<CameraToggleSplit {...base} compact />);
    expect(screen.queryByText("Camera")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Camera settings" })).not.toHaveAttribute(
      "aria-haspopup",
    );
  });

  it("reads BLOCKED and cannot turn the camera on while access is denied", async () => {
    const onToggle = vi.fn();
    const onOpenChange = vi.fn();
    render(<CameraToggleSplit {...base} blocked onToggle={onToggle} onOpenChange={onOpenChange} />);
    const body = screen.getByRole("button", { name: "Camera, blocked" });
    expect(screen.getByText("BLOCKED")).toBeInTheDocument();
    expect(body).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(body);
    expect(onToggle).not.toHaveBeenCalled();
    // The chevron still works: it is where the way out (System Settings) lives.
    await userEvent.click(screen.getByRole("button", { name: "Camera settings" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("can still turn off a camera that is on when access gets blocked", async () => {
    const onToggle = vi.fn();
    render(<CameraToggleSplit {...base} on blocked onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: "Camera, blocked" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
