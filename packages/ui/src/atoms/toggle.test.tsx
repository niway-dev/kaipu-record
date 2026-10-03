import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toggle } from "./toggle";

/**
 * These tests are the reason dropping Radix is safe: they pin the accessibility
 * contract the primitive used to provide — the switch role, the checked state,
 * and keyboard activation — to this implementation instead.
 */
describe("Toggle", () => {
  it("exposes the switch role and its checked state", () => {
    const { rerender } = render(<Toggle checked={false} onChange={() => {}} aria-label="Mic" />);
    expect(screen.getByRole("switch", { name: "Mic" })).not.toBeChecked();

    rerender(<Toggle checked onChange={() => {}} aria-label="Mic" />);
    expect(screen.getByRole("switch", { name: "Mic" })).toBeChecked();
  });

  it("reports the opposite of its current value when clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<Toggle checked={false} onChange={onChange} aria-label="Mic" />);

    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(<Toggle checked onChange={onChange} aria-label="Mic" />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("activates from the keyboard, which is what the native button buys", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} aria-label="Mic" />);

    await user.tab();
    expect(screen.getByRole("switch")).toHaveFocus();

    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does not fire while disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} disabled aria-label="Mic" />);

    await user.click(screen.getByRole("switch"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("moves the thumb only when checked", () => {
    const { container, rerender } = render(<Toggle checked={false} onChange={() => {}} />);
    const off = container.querySelector("span")!.className;

    rerender(<Toggle checked onChange={() => {}} />);
    const on = container.querySelector("span")!.className;

    expect(on).not.toBe(off);
  });

  it("is a button, so it never submits a surrounding form", () => {
    render(<Toggle checked={false} onChange={() => {}} aria-label="Mic" />);
    expect(screen.getByRole("switch")).toHaveAttribute("type", "button");
  });
});
