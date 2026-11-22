import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspectLayer } from "./inspect-layer";
import { RULER_HALO_PX, RULER_STROKE_PX, RULER_TICK_PX } from "../ruler-line";
import type { InspectController, InspectHover } from "./use-inspect";

const originalRect = Element.prototype.getBoundingClientRect;
const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

beforeEach(() => {
  // The layer is 800x600 at the origin; the HUD measures 200x150.
  Element.prototype.getBoundingClientRect = function () {
    return {
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
    } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 200,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 150,
  });
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = originalRect;
  if (offsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidth);
  if (offsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
});

function hoverAt(
  clientX: number,
  clientY: number,
  extra: Partial<InspectHover> = {},
): InspectHover {
  return { x: 3, y: 1, color: { r: 246, g: 5, b: 92, a: 255 }, clientX, clientY, ...extra };
}

function controller(over: Partial<InspectController> = {}): InspectController {
  return {
    enabled: true,
    active: true,
    setActive: vi.fn(),
    toggle: vi.fn(),
    format: "hex",
    setFormat: vi.fn(),
    asCaptured: false,
    setAsCaptured: vi.fn(),
    hover: null,
    readout: "#F6055C",
    loupe: null,
    onPointerMove: vi.fn(),
    onPointerLeave: vi.fn(),
    copyValue: vi.fn(async () => true),
    picked: null,
    recents: [],
    loupeShown: true,
    setLoupeShown: vi.fn(),
    pick: vi.fn(() => true),
    copied: false,
    copiedText: null,
    status: "ready",
    capturedUnavailable: false,
    buffer: null,
    ruler: null,
    setRuler: vi.fn(),
    tolerance: 10,
    setTolerance: vi.fn(),
    toleranceShown: false,
    empty: null,
    outerLocked: false,
    setOuterLocked: vi.fn(),
    outer: false,
    run: null,
    onWheel: vi.fn(() => false),
    pin: vi.fn(() => false),
    ...over,
  } as InspectController;
}

const hud = (): HTMLElement => document.querySelector('[data-ui-area="editorImage.inspectHud"]')!;

describe("InspectLayer HUD", () => {
  it("sits right of and below the pointer when it fits", () => {
    render(<InspectLayer inspect={controller({ hover: hoverAt(100, 100) })} />);
    expect(hud()).toHaveAttribute("data-flip-x", "false");
    expect(hud()).toHaveAttribute("data-flip-y", "false");
    expect(hud().style.left).toBe("122px");
    expect(hud().style.top).toBe("122px");
  });

  it("flips left and up near the right and bottom edges, without reordering the DOM", () => {
    render(<InspectLayer inspect={controller({ hover: hoverAt(780, 580) })} />);
    expect(hud()).toHaveAttribute("data-flip-x", "true");
    expect(hud()).toHaveAttribute("data-flip-y", "true");
    expect(hud().style.left).toBe(`${780 - 22 - 200}px`);
    expect(hud().style.top).toBe(`${580 - 22 - 150}px`);
    // Loupe first, chip second, whatever the flip.
    expect(hud().children[0]!.querySelector('[data-testid="inspect-loupe"]')).not.toBeNull();
    expect(hud().children[1]!.children[1]).toHaveTextContent("#F6055C");
  });

  it("leaves the loupe out of the HUD when it is switched off, keeping the chip", () => {
    render(<InspectLayer inspect={controller({ hover: hoverAt(100, 100), loupeShown: false })} />);
    expect(screen.queryByTestId("inspect-loupe")).toBeNull();
    // The chip now leads the HUD (it was second, after the loupe).
    expect(hud().children[0]).toHaveTextContent("#F6055C");
  });

  it("draws the crosshair at the pointer and hides the system cursor", () => {
    render(<InspectLayer inspect={controller({ hover: hoverAt(100, 80) })} />);
    const cross = screen.getByTestId("inspect-crosshair");
    expect(cross.style.left).toBe("100px");
    expect(cross.style.top).toBe("80px");
    expect(screen.getByTestId("inspect-layer").className).toMatch(/layerBare/);
  });

  it("tags the chip with the shown format", () => {
    render(<InspectLayer inspect={controller({ hover: hoverAt(10, 10), format: "oklch" })} />);
    expect(screen.getByTestId("inspect-format-tag")).toHaveTextContent("OKLCH");
  });

  it("reads AS CAPTURED · P3 when the captured pixel is out of sRGB", () => {
    render(
      <InspectLayer
        inspect={controller({ asCaptured: true, hover: hoverAt(10, 10, { outOfGamut: true }) })}
      />,
    );
    expect(screen.getByTestId("inspect-format-tag")).toHaveTextContent("AS CAPTURED · P3");
    // As captured is on: the explanation body is gone, the heading stays.
    expect(screen.getByText("Out of sRGB")).toBeInTheDocument();
    expect(screen.queryByText(/nearest sRGB color/)).toBeNull();
  });

  it("shows the P3 badge and the explanation for an out-of-sRGB pixel", () => {
    render(<InspectLayer inspect={controller({ hover: hoverAt(10, 10, { outOfGamut: true }) })} />);
    expect(screen.getByText("P3 ↗")).toBeInTheDocument();
    expect(screen.getByText("Out of sRGB")).toBeInTheDocument();
    expect(screen.getByText(/nearest sRGB color/)).toBeInTheDocument();
    expect(screen.getByText("As captured").tagName).toBe("B");
  });

  it("swaps the swatch for a check while copied, keeping it the first chip child", () => {
    render(<InspectLayer inspect={controller({ copied: true, hover: hoverAt(10, 10) })} />);
    const swatch = hud().children[1]!.children[0] as HTMLElement;
    expect(swatch).toHaveAttribute("data-copied", "true");
    expect(swatch.querySelector("svg")).not.toBeNull();
  });

  it("adds the OUTER sub to the ruler label without changing its text", () => {
    const run = {
      run: { axis: "x", at: 1, from: 0, to: 4 },
      length: 916,
      outer: true,
      line: { x1: 10, y1: 50, x2: 200, y2: 50 },
    } as unknown as InspectController["run"];
    render(<InspectLayer inspect={controller({ run, hover: hoverAt(50, 50) })} />);
    const label = screen.getByTestId("inspect-ruler-length");
    expect(label).toHaveTextContent(/^916 px$/);
    expect(label).toHaveAttribute("data-sub", "OUTER · ⇧");
  });

  it("draws the ruler with the shared line constants (the pinned measure uses the same)", () => {
    const run = {
      run: { axis: "x", at: 1, from: 0, to: 4 },
      length: 190,
      outer: false,
      line: { x1: 10, y1: 50, x2: 200, y2: 50 },
    } as unknown as InspectController["run"];
    render(<InspectLayer inspect={controller({ run, hover: hoverAt(50, 50) })} />);
    const lines = screen.getByTestId("inspect-ruler").querySelectorAll("line");
    // Halo then accent copies of the line and its two caps.
    expect(lines).toHaveLength(6);
    for (const l of Array.from(lines).slice(0, 3)) {
      expect(l.getAttribute("stroke-width")).toBe(String(RULER_HALO_PX));
    }
    for (const l of Array.from(lines).slice(3)) {
      expect(l.getAttribute("stroke-width")).toBe(String(RULER_STROKE_PX));
    }
    const cap = lines[1]!;
    expect(Math.abs(Number(cap.getAttribute("y2")) - Number(cap.getAttribute("y1")))).toBe(
      RULER_TICK_PX * 2,
    );
  });

  it("puts the tolerance card beside the pointer, never over the HUD", () => {
    const { rerender } = render(
      <InspectLayer inspect={controller({ hover: hoverAt(300, 100), toleranceShown: true })} />,
    );
    const card = (): HTMLElement => screen.getByTestId("inspect-tolerance-card");
    // HUD right and below: the card goes left of the pointer, below it.
    expect(card().style.left).toBe(`${300 - 12 - 150}px`);
    expect(card().style.top).toBe(`${100 + 12}px`);
    // At the bottom-right corner the HUD flips both ways and the right side has no room:
    // the card goes past the HUD's far edge (HUD at 780 - 22 - 200 = 558).
    rerender(
      <InspectLayer inspect={controller({ hover: hoverAt(780, 580), toleranceShown: true })} />,
    );
    expect(card().style.left).toBe(`${558 - 12 - 150}px`);
    expect(card().style.top).toBe(`${580 - 12 - 44}px`);
  });

  it("shows the tolerance card only while toleranceShown", () => {
    const { rerender } = render(
      <InspectLayer inspect={controller({ hover: hoverAt(300, 100) })} />,
    );
    expect(screen.queryByTestId("inspect-tolerance-card")).toBeNull();
    rerender(
      <InspectLayer
        inspect={controller({ hover: hoverAt(300, 100), toleranceShown: true, tolerance: 255 })}
      />,
    );
    const card = screen.getByTestId("inspect-tolerance-card");
    expect(card).toHaveTextContent("TOLERANCE");
    expect(card).toHaveTextContent("255");
  });
});

function click(layer: HTMLElement, at = { clientX: 100, clientY: 100 }): void {
  fireEvent.pointerDown(layer, { button: 0, pointerId: 1, ...at });
  fireEvent.pointerUp(layer, { button: 0, pointerId: 1, ...at });
}

describe("InspectLayer click", () => {
  it("picks the pixel color when no measurement is shown", () => {
    const pin = vi.fn(() => false);
    const pick = vi.fn(() => true);
    render(<InspectLayer inspect={controller({ hover: hoverAt(100, 100), pin, pick })} />);
    click(screen.getByTestId("inspect-layer"));
    expect(pin).toHaveBeenCalledTimes(1);
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it("only pins the measurement while a run is shown, without picking", () => {
    const pin = vi.fn(() => true);
    const pick = vi.fn(() => true);
    render(<InspectLayer inspect={controller({ hover: hoverAt(100, 100), pin, pick })} />);
    click(screen.getByTestId("inspect-layer"));
    expect(pin).toHaveBeenCalledTimes(1);
    expect(pick).not.toHaveBeenCalled();
  });

  it("does not pick when the pointer dragged past the click slop", () => {
    const pick = vi.fn(() => true);
    render(<InspectLayer inspect={controller({ hover: hoverAt(100, 100), pick })} />);
    const layer = screen.getByTestId("inspect-layer");
    fireEvent.pointerDown(layer, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(layer, { button: 0, pointerId: 1, clientX: 160, clientY: 100 });
    expect(pick).not.toHaveBeenCalled();
  });

  it("ignores a secondary button", () => {
    const pick = vi.fn(() => true);
    render(<InspectLayer inspect={controller({ hover: hoverAt(100, 100), pick })} />);
    const layer = screen.getByTestId("inspect-layer");
    fireEvent.pointerDown(layer, { button: 2, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(layer, { button: 2, pointerId: 1, clientX: 100, clientY: 100 });
    expect(pick).not.toHaveBeenCalled();
  });
});

describe("InspectLayer empty canvas", () => {
  it("renders the empty readout in its own area, not the HUD", () => {
    render(<InspectLayer inspect={controller({ empty: { clientX: 100, clientY: 100 } })} />);
    const el = document.querySelector('[data-ui-area="editorImage.inspectEmpty"]');
    expect(el).not.toBeNull();
    expect(hud()).toBeNull();
    expect(screen.getByText("NO PIXELS HERE")).toBeInTheDocument();
    expect(screen.getByText("Nothing to read")).toBeInTheDocument();
  });

  it("renders nothing when the pointer is not over the layer", () => {
    render(<InspectLayer inspect={controller()} />);
    expect(document.querySelector('[data-ui-area="editorImage.inspectEmpty"]')).toBeNull();
    expect(screen.queryByTestId("inspect-crosshair")).toBeNull();
  });

  it("hides the hatched loupe on an empty spot when the loupe is switched off", () => {
    const { rerender } = render(
      <InspectLayer inspect={controller({ empty: { clientX: 100, clientY: 100 } })} />,
    );
    const hatched = (): Element | null => document.querySelector('[class*="loupeEmpty"]');
    expect(hatched()).not.toBeNull();
    rerender(
      <InspectLayer
        inspect={controller({ empty: { clientX: 100, clientY: 100 }, loupeShown: false })}
      />,
    );
    expect(hatched()).toBeNull();
    expect(screen.queryByText("NO PIXELS HERE")).toBeNull();
    expect(screen.getByText("Nothing to read")).toBeInTheDocument();
  });
});
