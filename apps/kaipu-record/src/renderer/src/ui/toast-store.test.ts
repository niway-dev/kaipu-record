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
});
