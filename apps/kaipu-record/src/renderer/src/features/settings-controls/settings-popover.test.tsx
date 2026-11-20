import React, { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsPopover } from "./settings-popover";

function Harness({ startOpen = true }: { startOpen?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(startOpen);
  const chevron = useRef<HTMLButtonElement>(null);
  return (
    <div data-testid="page">
      <div data-settings-anchor data-testid="card">
        <button type="button" data-testid="toggle">
          toggle
        </button>
        <button
          ref={chevron}
          type="button"
          aria-expanded={open}
          aria-controls={open ? "pop" : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          chevron
        </button>
      </div>
      <button type="button" data-testid="elsewhere">
        elsewhere
      </button>
      <SettingsPopover
        id="pop"
        label="Camera settings"
        open={open}
        anchorRef={chevron}
        onClose={() => setOpen(false)}
      >
        <div role="radiogroup" aria-label="Cameras">
          <button type="button" role="radio" aria-checked="false" tabIndex={-1}>
            One
          </button>
          <button type="button" role="radio" aria-checked="true" tabIndex={0}>
            Two
          </button>
        </div>
      </SettingsPopover>
    </div>
  );
}

const rect = (top: number, left = 100, width = 300, height = 56): DOMRect =>
  ({
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

describe("SettingsPopover", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 300,
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
  });

  it("is a dialog drawn in the body, so nothing is inserted into the page's flow", () => {
    const { container } = render(<Harness />);
    const dialog = screen.getByRole("dialog", { name: "Camera settings" });
    expect(dialog).toHaveAttribute("id", "pop");
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    expect(container.querySelector("[role=dialog]")).toBeNull();
  });

  it("renders nothing while closed", () => {
    render(<Harness startOpen={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves focus into the checked radio on open", () => {
    render(<Harness />);
    expect(screen.getByRole("radio", { name: "Two" })).toHaveFocus();
  });

  it("closes on Esc, hands focus back to the chevron and keeps Esc from the window handlers", () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    render(<Harness />);

    fireEvent.keyDown(screen.getByRole("radio", { name: "Two" }), { key: "Escape" });

    window.removeEventListener("keydown", onWindowKey);
    expect(onWindowKey).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "chevron" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "chevron" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("Esc closes it even when focus is not inside (a click on the popover's background)", () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    render(<Harness />);
    (document.activeElement as HTMLElement).blur();

    fireEvent.keyDown(document.body, { key: "Escape" });

    window.removeEventListener("keydown", onWindowKey);
    expect(onWindowKey).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Enter inside it never reaches a window-level handler (it would start the recording)", () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    render(<Harness />);

    fireEvent.keyDown(screen.getByRole("radio", { name: "Two" }), { key: "Enter" });

    window.removeEventListener("keydown", onWindowKey);
    expect(onWindowKey).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("any key inside it stays out of the window handlers (bare 1/2/3 would switch the capture mode)", () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    render(<Harness />);

    fireEvent.keyDown(screen.getByRole("radio", { name: "Two" }), { key: "2" });
    fireEvent.keyDown(screen.getByRole("radio", { name: "Two" }), { key: "Tab" });

    window.removeEventListener("keydown", onWindowKey);
    expect(onWindowKey).not.toHaveBeenCalled();
  });

  it("closes when focus moves to an element outside it and its card, and does not steal focus back", () => {
    render(<Harness />);
    const elsewhere = screen.getByTestId("elsewhere");

    act(() => elsewhere.focus());

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(elsewhere).toHaveFocus();
  });

  it("closes when Tab leaves focus on nothing while the window stays focused", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    render(<Harness />);

    act(() => (document.activeElement as HTMLElement).blur());
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays open when focus goes to nothing because the window itself blurred", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    render(<Harness />);

    act(() => (document.activeElement as HTMLElement).blur());
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("stays open when focus moves to its chevron or to another control inside it", () => {
    render(<Harness />);

    act(() => screen.getByRole("button", { name: "chevron" }).focus());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => screen.getByRole("radio", { name: "One" }).focus());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on a press outside it, but not on a press inside it or on its own card", () => {
    render(<Harness />);

    fireEvent.pointerDown(screen.getByRole("radio", { name: "One" }));
    fireEvent.pointerDown(screen.getByTestId("toggle"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByTestId("elsewhere"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the chevron closes it and a second press opens it again (the card press does not reopen it)", () => {
    render(<Harness />);
    const chevron = screen.getByRole("button", { name: "chevron" });

    fireEvent.pointerDown(chevron);
    fireEvent.click(chevron);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(chevron);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens below its card, or above it when the card is at the bottom of the window", () => {
    const below = render(<Harness startOpen={false} />);
    screen.getByTestId("card").getBoundingClientRect = () => rect(200);
    fireEvent.click(screen.getByRole("button", { name: "chevron" }));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-side", "below");
    below.unmount();

    const above = render(<Harness startOpen={false} />);
    screen.getByTestId("card").getBoundingClientRect = () => rect(730);
    fireEvent.click(screen.getByRole("button", { name: "chevron" }));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-side", "above");
    above.unmount();
  });
});
