import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useShotMetrics } from "./use-shot-metrics";

/** An <img> whose layout size the test sets, since jsdom has no layout. */
const imgOf = (w: number, h: number): HTMLImageElement => {
  const img = document.createElement("img");
  Object.defineProperty(img, "clientWidth", { value: w, configurable: true, writable: true });
  Object.defineProperty(img, "clientHeight", { value: h, configurable: true, writable: true });
  Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
  return img;
};

describe("useShotMetrics", () => {
  const observers: { callback: () => void; observed: Set<Element> }[] = [];
  const original = globalThis.ResizeObserver;

  beforeEach(() => {
    globalThis.ResizeObserver = class {
      private readonly entry: { callback: () => void; observed: Set<Element> };
      constructor(callback: () => void) {
        this.entry = { callback, observed: new Set() };
        observers.push(this.entry);
      }
      observe(el: Element): void {
        this.entry.observed.add(el);
      }
      unobserve(el: Element): void {
        this.entry.observed.delete(el);
      }
      disconnect(): void {
        this.entry.observed.clear();
      }
    } as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    globalThis.ResizeObserver = original;
    observers.length = 0;
  });

  it("measures the shot that replaced the observed one, not the detached one's zero size", () => {
    const first = imgOf(400, 300);
    document.body.append(first);
    const ref = { current: first as HTMLImageElement | null };
    const { result } = renderHook(() => useShotMetrics(ref, true, true));
    expect(result.current).toMatchObject({ w: 400, h: 300 });

    // The frame re-rendered into another tree (windowing a crop): React mounts a new <img>
    // and drops the first, which the observer reports as a 0x0 element.
    const second = imgOf(400, 300);
    first.remove();
    document.body.append(second);
    ref.current = second;
    Object.defineProperty(first, "clientWidth", { value: 0 });
    Object.defineProperty(first, "clientHeight", { value: 0 });
    act(() => observers.forEach((o) => o.callback()));

    expect(result.current).toMatchObject({ w: 400, h: 300 });
    // Later resizes of the cropped shot are tracked: the observer now watches the new <img>.
    expect([...observers[0]!.observed]).toEqual([second]);
  });
});
