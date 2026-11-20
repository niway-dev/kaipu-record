import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { render, screen, within } from "@testing-library/react";
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

  it("keeps the full current choice on hover, since the line truncates", () => {
    render(<SetupCard {...base} detail="iPhone Camera · circle, M" />);
    expect(screen.getByText("iPhone Camera · circle, M").closest("button")).toHaveAttribute(
      "title",
      "iPhone Camera · circle, M",
    );
  });

  it("toggles from the left zone (name and readout) with a click, and only that", async () => {
    const onToggle = vi.fn();
    const onOpenChange = vi.fn();
    render(<SetupCard {...base} onToggle={onToggle} onOpenChange={onOpenChange} />);
    const toggle = screen.getByRole("switch", { name: "Microphone" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(within(toggle).getByText("Microphone")).toBeInTheDocument();
    expect(within(toggle).getByText("ON")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("toggles from the keyboard with Space and Enter", async () => {
    const onToggle = vi.fn();
    render(<SetupCard {...base} onToggle={onToggle} />);
    await userEvent.tab();
    expect(screen.getByRole("switch", { name: "Microphone" })).toHaveFocus();
    await userEvent.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("never toggles from the right zone, the device name or the chevron", async () => {
    const onToggle = vi.fn();
    const onOpenChange = vi.fn();
    render(<SetupCard {...base} onToggle={onToggle} onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByText("Yeti Nano"));
    await userEvent.click(screen.getByRole("button", { name: /^Microphone settings/ }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledTimes(2);

    screen.getByRole("button", { name: /^Microphone settings/ }).focus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Enter}");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("opens and closes the panel from the right zone, without toggling", async () => {
    const onToggle = vi.fn();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <SetupCard {...base} onToggle={onToggle} onOpenChange={onOpenChange} />,
    );
    const device = screen.getByRole("button", { name: /^Microphone settings/ });
    expect(device).toHaveAttribute("aria-expanded", "false");
    expect(within(device).getByText("Yeti Nano")).toBeInTheDocument();
    await userEvent.click(device);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    rerender(<SetupCard {...base} open onToggle={onToggle} onOpenChange={onOpenChange} />);
    expect(device).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(device);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("hands the right zone to chevronRef, so the panel can return focus to it", () => {
    const chevronRef = createRef<HTMLButtonElement>();
    render(<SetupCard {...base} chevronRef={chevronRef} />);
    expect(chevronRef.current).toBe(screen.getByRole("button", { name: /^Microphone settings/ }));
    chevronRef.current?.focus();
    expect(screen.getByRole("button", { name: /^Microphone settings/ })).toHaveFocus();
  });

  it("has one switch and one button, neither inside the other", () => {
    render(<SetupCard {...base} />);
    const toggle = screen.getByRole("switch");
    const device = screen.getByRole("button");
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(toggle.contains(device)).toBe(false);
    expect(device.contains(toggle)).toBe(false);
    expect(toggle.querySelector("button, [role='switch'], a, input")).toBeNull();
    expect(device.querySelector("button, [role='switch'], a, input")).toBeNull();
  });

  it("marks the open card, so it can take the accent border", () => {
    const { container } = render(<SetupCard {...base} open />);
    expect(container.firstElementChild).toHaveAttribute("data-open", "true");
  });

  it("does nothing from a blocked left zone, keeps it focusable and explained, and the right zone still opens", async () => {
    const onToggle = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <SetupCard
        {...base}
        on={false}
        blocked
        switchDisabled
        switchLabel="Camera blocked"
        switchTitle="Allow camera access in System Settings"
        onToggle={onToggle}
        onOpenChange={onOpenChange}
      />,
    );
    const toggle = screen.getByRole("switch", { name: "Camera blocked" });
    expect(toggle).toHaveAttribute("title", "Allow camera access in System Settings");
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).not.toBeDisabled();
    await userEvent.tab();
    expect(toggle).toHaveFocus();
    await userEvent.click(toggle);
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Enter}");
    expect(onToggle).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /^Microphone settings/ }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("disables only the left zone when the source is unavailable; the device zone still opens the panel", async () => {
    const onToggle = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <SetupCard
        {...base}
        on={false}
        switchUnavailable
        switchTitle="Not available on this system"
        onToggle={onToggle}
        onOpenChange={onOpenChange}
      />,
    );
    const toggle = screen.getByRole("switch", { name: "Microphone" });
    const device = screen.getByRole("button", { name: /^Microphone settings/ });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("title", "Not available on this system");
    expect(device).toBeEnabled();
    expect(device).toHaveAttribute("title", "Yeti Nano");
    await userEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
    await userEvent.click(device);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("names the device zone after both the settings label and the visible device", () => {
    const { rerender } = render(<SetupCard {...base} />);
    expect(
      screen.getByRole("button", { name: "Microphone settings: Yeti Nano" }),
    ).toBeInTheDocument();
    rerender(<SetupCard {...base} detail={"\u00a0"} />);
    expect(screen.getByRole("button", { name: "Microphone settings" })).toBeInTheDocument();
  });
});
