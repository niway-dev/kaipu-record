import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Mic } from "lucide-react";
import { SetupCard } from "./setup-card";

const base = {
  icon: Mic,
  name: "Microphone",
  detail: "Yeti Nano",
  status: "ON",
  on: true,
  onToggle: vi.fn(),
  chevronLabel: "Microphone settings",
  open: false,
  onOpenChange: vi.fn(),
};

describe("SetupCard", () => {
  it("shows the name, the current choice and the ON readout", () => {
    render(<SetupCard {...base} />);
    expect(screen.getByText("Microphone")).toBeInTheDocument();
    expect(screen.getByText("Yeti Nano")).toBeInTheDocument();
    expect(screen.getByText("ON")).toBeInTheDocument();
  });

  it("toggles from the switch, and the switch alone", async () => {
    const onToggle = vi.fn();
    const onOpenChange = vi.fn();
    render(<SetupCard {...base} onToggle={onToggle} onOpenChange={onOpenChange} />);
    const toggle = screen.getByRole("switch", { name: "Microphone" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("opens and closes the panel from its own chevron, without toggling", async () => {
    const onToggle = vi.fn();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <SetupCard {...base} onToggle={onToggle} onOpenChange={onOpenChange} />,
    );
    const chevron = screen.getByRole("button", { name: "Microphone settings" });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(chevron);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    rerender(<SetupCard {...base} open onToggle={onToggle} onOpenChange={onOpenChange} />);
    expect(chevron).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(chevron);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("marks the open card, so it can take the accent border", () => {
    const { container } = render(<SetupCard {...base} open />);
    expect(container.firstElementChild).toHaveAttribute("data-open", "true");
  });

  it("does nothing from a disabled switch, but the chevron still opens", async () => {
    const onToggle = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <SetupCard
        {...base}
        switchDisabled
        switchTitle="Not available"
        onToggle={onToggle}
        onOpenChange={onOpenChange}
      />,
    );
    const toggle = screen.getByTitle("Not available");
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
