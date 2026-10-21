import { useRef } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCompactRow } from "./use-compact-row";

// jsdom lays nothing out, so the row and its groups declare the widths a real
// layout would have measured.
function Row({ widths, revision = 0 }: { widths: [number, number, number]; revision?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useCompactRow(ref, revision);
  return (
    <div ref={ref} data-testid="row" data-client-width={widths[0]}>
      <span data-offset-width={widths[1]} />
      <span data-offset-width={widths[2]} />
    </div>
  );
}

type ResizeCallback = ConstructorParameters<typeof ResizeObserver>[0];

describe("useCompactRow", () => {
  const resizeCallbacks: ResizeCallback[] = [];
  const widthProps = ["clientWidth", "offsetWidth"] as const;
  const original = Object.fromEntries(
    widthProps.map((p) => [p, Object.getOwnPropertyDescriptor(HTMLElement.prototype, p)]),
  );

  beforeEach(() => {
    resizeCallbacks.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeCallback) {
          resizeCallbacks.push(callback);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    for (const prop of widthProps) {
      Object.defineProperty(HTMLElement.prototype, prop, {
        configurable: true,
        get(this: HTMLElement) {
          const attr = prop === "clientWidth" ? "data-client-width" : "data-offset-width";
          return Number(this.getAttribute(attr) ?? 0);
        },
      });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const prop of widthProps) {
      const descriptor = original[prop];
      if (descriptor) Object.defineProperty(HTMLElement.prototype, prop, descriptor);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
    }
  });

  const fireResize = (): void => {
    const callback = resizeCallbacks.at(-1);
    if (!callback) throw new Error("no ResizeObserver registered");
    act(() => callback([], {} as ResizeObserver));
  };

  it("leaves a row whose groups fit side by side expanded", () => {
    const { getByTestId } = render(<Row widths={[600, 280, 290]} />);
    expect(getByTestId("row")).toHaveAttribute("data-compact", "false");
  });

  it("collapses a row whose groups would overflow it", () => {
    const { getByTestId } = render(<Row widths={[500, 280, 290]} />);
    expect(getByTestId("row")).toHaveAttribute("data-compact", "true");
  });

  it("re-measures when the row resizes", () => {
    const { getByTestId, rerender } = render(<Row widths={[600, 280, 290]} />);
    rerender(<Row widths={[500, 280, 290]} />);
    expect(getByTestId("row")).toHaveAttribute("data-compact", "false");
    fireResize();
    expect(getByTestId("row")).toHaveAttribute("data-compact", "true");
  });

  it("re-measures when the caller's revision changes, without a resize", () => {
    const { getByTestId, rerender } = render(<Row widths={[600, 280, 290]} />);
    // A label grew (say, "Save" became "Saved") — the row is the same width.
    rerender(<Row widths={[600, 280, 340]} revision={1} />);
    expect(getByTestId("row")).toHaveAttribute("data-compact", "true");
  });

  it("expands a collapsed row again once its content fits", () => {
    const { getByTestId, rerender } = render(<Row widths={[500, 280, 290]} />);
    expect(getByTestId("row")).toHaveAttribute("data-compact", "true");
    rerender(<Row widths={[700, 280, 290]} />);
    fireResize();
    expect(getByTestId("row")).toHaveAttribute("data-compact", "false");
  });
});
