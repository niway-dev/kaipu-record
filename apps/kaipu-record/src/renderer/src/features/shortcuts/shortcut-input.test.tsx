import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShortcutInput } from "./shortcut-input";

describe("ShortcutInput", () => {
  it("shows the current binding as a formatted label", () => {
    render(<ShortcutInput value="Command+Control+C" onChange={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveTextContent("⌃⌘C");
  });

  it("enters listening mode on click and captures a valid combo", () => {
    const onChange = vi.fn();
    render(<ShortcutInput value="Command+Control+C" onChange={onChange} />);
    const button = screen.getByRole("button");

    fireEvent.click(button);
    expect(button).toHaveTextContent("Press keys…");

    fireEvent.keyDown(window, { code: "KeyG", key: "g", metaKey: true, ctrlKey: true });

    expect(onChange).toHaveBeenCalledWith("Command+Control+G");
    // The prop value is unchanged (parent didn't re-render), so it returns to ⌃⌘C.
    expect(button).toHaveTextContent("⌃⌘C");
  });

  it("ignores a combo without Command/Control while listening", () => {
    const onChange = vi.fn();
    render(<ShortcutInput value="Command+Control+C" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));

    fireEvent.keyDown(window, { code: "KeyG", key: "g", shiftKey: true, altKey: true });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveTextContent("Press keys…"); // still listening
  });

  it("cancels on Escape without changing the binding", () => {
    const onChange = vi.fn();
    render(<ShortcutInput value="Command+Control+C" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));

    fireEvent.keyDown(window, { code: "Escape", key: "Escape" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveTextContent("⌃⌘C");
  });

  it("flags an unavailable binding", () => {
    render(<ShortcutInput value="Command+Control+C" onChange={vi.fn()} unavailable />);
    expect(screen.getByRole("button")).toHaveAttribute("data-unavailable");
  });
});
