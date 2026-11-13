import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { IDENTITY_VIEW } from "./viewport";
import { useCanvasViewport } from "./use-canvas-viewport";

/**
 * A canvas whose frame is larger than the viewport, so Shift+1 (fit) really changes the view.
 * jsdom reports 0 for every layout size, so the sizes are stubbed on the two elements.
 */
function makeCanvas(): HTMLDivElement {
  const canvas = document.createElement("div");
  const frame = document.createElement("div");
  canvas.appendChild(frame);
  document.body.appendChild(canvas);
  const sizes: Record<string, number> = {
    clientWidth: 800,
    clientHeight: 600,
    offsetWidth: 2000,
    offsetHeight: 1000,
  };
  for (const [prop, value] of Object.entries(sizes)) {
    Object.defineProperty(prop.startsWith("client") ? canvas : frame, prop, { value });
  }
  return canvas;
}

function pressShiftOne(target: EventTarget = document.body): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { code: "Digit1", key: "!", shiftKey: true, bubbles: true }),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useCanvasViewport Shift+1 with an overlay open", () => {
  it("fits the content when nothing is open", () => {
    const canvas = makeCanvas();
    const ref = { current: canvas } as RefObject<HTMLDivElement>;
    const { result } = renderHook(() => useCanvasViewport(ref, true, true));

    act(() => pressShiftOne());

    expect(result.current.view).not.toEqual(IDENTITY_VIEW);
  });

  it("does not fit while a toolbar menu (role=menu) is open", () => {
    const canvas = makeCanvas();
    const ref = { current: canvas } as RefObject<HTMLDivElement>;
    const { result } = renderHook(() => useCanvasViewport(ref, true, true));
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);

    act(() => pressShiftOne());

    expect(result.current.view).toEqual(IDENTITY_VIEW);
  });

  it("does not fit while a dialog (aria-modal) is open", () => {
    const canvas = makeCanvas();
    const ref = { current: canvas } as RefObject<HTMLDivElement>;
    const { result } = renderHook(() => useCanvasViewport(ref, true, true));
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);

    act(() => pressShiftOne());

    expect(result.current.view).toEqual(IDENTITY_VIEW);
  });
});

describe("useCanvasViewport pan click", () => {
  const press = (type: "keydown" | "keyup"): void => {
    window.dispatchEvent(new KeyboardEvent(type, { code: "Space", key: " ", bubbles: true }));
  };
  const pointer = (button: number): React.PointerEvent<HTMLDivElement> =>
    ({
      button,
      clientX: 10,
      clientY: 10,
      pointerId: 1,
      preventDefault: () => {},
      stopPropagation: () => {},
      currentTarget: { setPointerCapture: () => {} },
    }) as unknown as React.PointerEvent<HTMLDivElement>;

  it("reports the click that ends a pan even when Space was released first (NIW2-759)", () => {
    const ref = { current: makeCanvas() } as RefObject<HTMLDivElement>;
    const { result } = renderHook(() => useCanvasViewport(ref, true, true));

    act(() => press("keydown"));
    act(() => result.current.bindings.onPointerDownCapture(pointer(0)));
    act(() => press("keyup"));
    act(() => result.current.bindings.onPointerUp(pointer(0)));

    // By the time the click arrives the pan is over and Space is up: panMode alone says idle.
    expect(result.current.panMode).toBe("idle");
    expect(result.current.consumePanClick()).toBe(true);
    expect(result.current.consumePanClick()).toBe(false);
  });

  it("does not report a click when no pan happened, or after a later press", () => {
    const ref = { current: makeCanvas() } as RefObject<HTMLDivElement>;
    const { result } = renderHook(() => useCanvasViewport(ref, true, true));
    expect(result.current.consumePanClick()).toBe(false);

    act(() => press("keydown"));
    act(() => result.current.bindings.onPointerDownCapture(pointer(0)));
    act(() => result.current.bindings.onPointerUp(pointer(0)));
    act(() => press("keyup"));
    // The click never came; the next press must not inherit the stale pan.
    act(() => result.current.bindings.onPointerDownCapture(pointer(0)));
    expect(result.current.consumePanClick()).toBe(false);
  });
});
