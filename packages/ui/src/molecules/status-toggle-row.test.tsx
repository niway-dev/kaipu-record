import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusToggleRow } from "./status-toggle-row";

function items(onToggleMic = vi.fn()) {
  return [
    { id: "mic", icon: null, label: "Mic", isActive: true, onToggle: onToggleMic },
    { id: "audio", icon: null, label: "Audio", isActive: false, onToggle: vi.fn() },
    { id: "camera", icon: null, label: "Camera", isActive: false, onToggle: vi.fn() },
  ];
}

describe("StatusToggleRow", () => {
  it("shows the labels in the full variant and drops them when compact", () => {
    const { rerender } = render(<StatusToggleRow items={items()} />);
    expect(screen.getByText("Mic")).toBeInTheDocument();
    expect(screen.getByText("Audio")).toBeInTheDocument();
    expect(screen.getByText("Camera")).toBeInTheDocument();

    rerender(<StatusToggleRow items={items()} variant="compact" />);
    expect(screen.queryByText("Mic")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("fires the callback of the tile that was clicked", async () => {
    const user = userEvent.setup();
    const onToggleMic = vi.fn();
    render(<StatusToggleRow items={items(onToggleMic)} />);
    await user.click(screen.getAllByRole("button")[0]!);
    expect(onToggleMic).toHaveBeenCalledOnce();
  });

  it("reflects each tile's own state", () => {
    render(<StatusToggleRow items={items()} />);
    expect(screen.getAllByText("ON")).toHaveLength(1);
    expect(screen.getAllByText("OFF")).toHaveLength(2);
  });

  it("passes custom readout words to every tile", () => {
    render(<StatusToggleRow items={items()} onText="Sí" offText="No" />);
    expect(screen.getAllByText("Sí")).toHaveLength(1);
    expect(screen.getAllByText("No")).toHaveLength(2);
  });
});
