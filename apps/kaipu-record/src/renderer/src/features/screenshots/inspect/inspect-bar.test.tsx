import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InspectBar } from "./inspect-bar";
import type { InspectController } from "./use-inspect";
import type { ColorsController } from "./colors/use-colors";
import type { PickedColor } from "@shared/image-inspect-settings";

const px = (r: number, g: number, b: number, captured?: PickedColor["captured"]): PickedColor => ({
  color: { r, g, b, a: 255 },
  ...(captured ? { captured } : {}),
});

function fake(over: Partial<InspectController> = {}): InspectController {
  return {
    enabled: true,
    active: true,
    format: "hex",
    asCaptured: false,
    ruler: null,
    toleranceShown: false,
    outer: false,
    outerLocked: false,
    tolerance: 12,
    copied: false,
    copiedText: null,
    status: "ready",
    capturedUnavailable: false,
    picked: null,
    recents: [],
    loupeShown: true,
    setActive: vi.fn(),
    setFormat: vi.fn(),
    setAsCaptured: vi.fn(),
    setRuler: vi.fn(),
    setTolerance: vi.fn(),
    setOuterLocked: vi.fn(),
    setLoupeShown: vi.fn(),
    copyValue: vi.fn(async () => true),
    ...over,
  } as unknown as InspectController;
}

describe("InspectBar", () => {
  it("keeps the accessible names and marks the picked format and ruler", () => {
    render(<InspectBar inspect={fake({ ruler: "x", format: "rgb" })} />);
    expect(screen.getByRole("button", { name: "Horizontal" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Vertical" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(screen.getByRole("button", { name: "RGB" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "HEX" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: "Exit Inspect" })).toBeNull();
  });

  it("reflects As captured", () => {
    render(<InspectBar inspect={fake({ asCaptured: true })} />);
    expect(screen.getByRole("button", { name: "As captured" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("colors the tolerance value while it was just changed", () => {
    const { rerender } = render(<InspectBar inspect={fake()} />);
    const value = screen.getByTestId("inspect-tolerance");
    expect(value.getAttribute("data-shown")).toBe("false");
    rerender(<InspectBar inspect={fake({ toleranceShown: true })} />);
    expect(screen.getByTestId("inspect-tolerance").getAttribute("data-shown")).toBe("true");
  });

  it("names every control with words: Width, Height, Outer, Tolerance, Loupe and Colors", () => {
    const colors = { open: false, toggle: vi.fn() } as unknown as ColorsController;
    render(<InspectBar inspect={fake({ ruler: "x" })} colors={colors} />);
    expect(screen.getByText("Width")).toBeTruthy();
    expect(screen.getByText("Height")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Outer" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Tolerance" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Loupe" }).textContent).toBe("Loupe");
    expect(screen.getByRole("button", { name: "Colors" }).textContent).toBe("Colors");
  });

  it("has no generic Copy color button: the copy names the value it copies", () => {
    render(<InspectBar inspect={fake({ picked: px(255, 0, 82) })} />);
    expect(screen.queryByRole("button", { name: "Copy color" })).toBeNull();
  });

  it("splits the panel into a Color section on top and a Ruler section below", () => {
    render(<InspectBar inspect={fake()} />);
    const color = screen.getByRole("group", { name: "Color" });
    const ruler = screen.getByRole("group", { name: "Ruler" });
    expect(color.compareDocumentPosition(ruler) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(color).getByRole("button", { name: "HEX" })).toBeTruthy();
    expect(within(color).getByRole("button", { name: "As captured" })).toBeTruthy();
    expect(within(ruler).getByText("Width")).toBeTruthy();
    expect(within(ruler).getByRole("group", { name: "Tolerance" })).toBeTruthy();
    expect(within(ruler).getByRole("button", { name: "Loupe" })).toBeTruthy();
    // The format and the color panel belong to Color, not to Ruler.
    expect(within(ruler).queryByRole("button", { name: "HEX" })).toBeNull();
    expect(within(color).queryByText("Width")).toBeNull();
  });

  describe("the picked color box", () => {
    it("shows a hint and a disabled Copy before any pick", () => {
      render(<InspectBar inspect={fake()} />);
      expect(screen.queryByTestId("inspect-picked-value")).toBeNull();
      expect((screen.getByRole("button", { name: "Copy" }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect(screen.getByRole("group", { name: "Color" }).getAttribute("data-picked")).toBe(
        "false",
      );
    });

    it("shows the value in the current format and a Copy that names it", () => {
      const copyValue = vi.fn(async () => true);
      render(<InspectBar inspect={fake({ picked: px(255, 0, 82), copyValue })} />);
      expect(screen.getByTestId("inspect-picked-value").textContent).toBe("#ff0052");
      fireEvent.click(screen.getByRole("button", { name: "Copy #ff0052" }));
      expect(copyValue).toHaveBeenCalledWith("#ff0052");
    });

    it("re-renders the box when the format changes (AC4)", () => {
      const picked = px(255, 0, 82);
      const { rerender } = render(<InspectBar inspect={fake({ picked, format: "hex" })} />);
      expect(screen.getByTestId("inspect-picked-value").textContent).toBe("#ff0052");
      rerender(<InspectBar inspect={fake({ picked, format: "rgb" })} />);
      expect(screen.getByTestId("inspect-picked-value").textContent).toBe("rgb(255, 0, 82)");
      expect(screen.getByRole("button", { name: "Copy rgb(255, 0, 82)" })).toBeTruthy();
      rerender(<InspectBar inspect={fake({ picked, format: "hsl" })} />);
      expect(screen.getByTestId("inspect-picked-value").textContent).toMatch(/^hsl\(/);
    });

    it("shows the captured bytes when As captured is on, and sRGB when the pick predates the probe", () => {
      const withCaptured = px(255, 0, 82, { r: 250, g: 10, b: 90, a: 255 });
      const { rerender } = render(
        <InspectBar inspect={fake({ picked: withCaptured, asCaptured: true })} />,
      );
      expect(screen.getByTestId("inspect-picked-value").textContent).toBe("#fa0a5a");
      rerender(<InspectBar inspect={fake({ picked: px(255, 0, 82), asCaptured: true })} />);
      expect(screen.getByTestId("inspect-picked-value").textContent).toBe("#ff0052");
    });

    it("tags a pick shown as sRGB while As captured is on, and not one with raw bytes", () => {
      const withCaptured = px(255, 0, 82, { r: 250, g: 10, b: 90, a: 255 });
      const { rerender } = render(
        <InspectBar inspect={fake({ picked: px(255, 0, 82), asCaptured: true })} />,
      );
      expect(screen.getByTestId("inspect-picked-srgb")).toHaveTextContent("sRGB");
      rerender(<InspectBar inspect={fake({ picked: withCaptured, asCaptured: true })} />);
      expect(screen.queryByTestId("inspect-picked-srgb")).toBeNull();
      rerender(<InspectBar inspect={fake({ picked: px(255, 0, 82), asCaptured: false })} />);
      expect(screen.queryByTestId("inspect-picked-srgb")).toBeNull();
    });

    it("says Copied while the value was just copied", () => {
      render(
        <InspectBar
          inspect={fake({ picked: px(255, 0, 82), copied: true, copiedText: "#ff0052" })}
        />,
      );
      expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    });
  });

  describe("the recents", () => {
    it("shows none until a pick has been replaced", () => {
      render(<InspectBar inspect={fake({ picked: px(1, 2, 3) })} />);
      expect(screen.queryByRole("group", { name: "Recent" })).toBeNull();
      expect(screen.getByRole("group", { name: "Color" }).getAttribute("data-recents")).toBe("0");
    });

    it("lists up to three chips with their values, and a click copies that value", () => {
      const copyValue = vi.fn(async () => true);
      const recents = [px(255, 0, 0), px(0, 255, 0), px(0, 0, 255)];
      render(<InspectBar inspect={fake({ picked: px(1, 2, 3), recents, copyValue })} />);
      const list = screen.getByRole("group", { name: "Recent" });
      expect(within(list).getAllByRole("listitem")).toHaveLength(3);
      expect(screen.getByRole("group", { name: "Color" }).getAttribute("data-recents")).toBe("3");
      fireEvent.click(within(list).getByRole("button", { name: "Copy #00ff00" }));
      expect(copyValue).toHaveBeenCalledWith("#00ff00");
    });

    it("re-renders the chips when the format changes (AC4)", () => {
      const recents = [px(255, 0, 0)];
      const picked = px(1, 2, 3);
      const { rerender } = render(<InspectBar inspect={fake({ picked, recents })} />);
      expect(screen.getByRole("button", { name: "Copy #ff0000" })).toBeTruthy();
      rerender(<InspectBar inspect={fake({ picked, recents, format: "rgb" })} />);
      expect(screen.getByRole("button", { name: "Copy rgb(255, 0, 0)" })).toBeTruthy();
    });
  });

  describe("the Loupe switch", () => {
    it("reflects the setting and flips it", () => {
      const setLoupeShown = vi.fn();
      const { rerender } = render(<InspectBar inspect={fake({ setLoupeShown })} />);
      const button = screen.getByRole("button", { name: "Loupe" });
      expect(button.getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(button);
      expect(setLoupeShown).toHaveBeenCalledWith(false);
      rerender(<InspectBar inspect={fake({ setLoupeShown, loupeShown: false })} />);
      expect(screen.getByRole("button", { name: "Loupe" }).getAttribute("aria-pressed")).toBe(
        "false",
      );
      fireEvent.click(screen.getByRole("button", { name: "Loupe" }));
      expect(setLoupeShown).toHaveBeenLastCalledWith(true);
    });
  });
});
