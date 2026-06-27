import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts, showToast, subscribeToasts } from "./toast-store";

afterEach(() => {
  for (const t of getToasts()) dismissToast(t.id);
  vi.useRealTimers();
});

describe("toast store", () => {
  it("adds a toast and notifies subscribers", () => {
    const listener = vi.fn();
    const unsub = subscribeToasts(listener);
    const id = showToast({ message: "hola" });
    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0]).toMatchObject({ id, message: "hola" });
    expect(listener).toHaveBeenCalled();
    unsub();
  });

  it("dismisses by id", () => {
    const id = showToast({ message: "chau" });
    dismissToast(id);
    expect(getToasts()).toHaveLength(0);
  });

  it("auto-dismisses after the duration", () => {
    vi.useFakeTimers();
    showToast({ message: "fugaz", durationMs: 5000 });
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(getToasts()).toHaveLength(0);
  });

  it("keeps a retry action's callback", () => {
    const retry = vi.fn();
    showToast({ message: "falló", action: { label: "Reintentar", onClick: retry } });
    getToasts()[0].action?.onClick();
    expect(retry).toHaveBeenCalled();
  });

  it("caps the stack at 3, dropping the oldest", () => {
    const ids = [1, 2, 3, 4].map((n) => showToast({ message: `t${n}` }));
    const visible = getToasts();
    expect(visible).toHaveLength(3);
    expect(visible.map((t) => t.message)).toEqual(["t2", "t3", "t4"]);
    // the dropped oldest id is gone
    expect(visible.some((t) => t.id === ids[0])).toBe(false);
  });
});
