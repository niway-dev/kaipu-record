import { describe, expect, it } from "vitest";
import { act, fireEvent, renderHook } from "@testing-library/react";
import { useSettingsDisclosure } from "./use-settings-disclosure";
import { useWindowFocus } from "./use-window-focus";

describe("useSettingsDisclosure", () => {
  it("closes an open disclosure when the window loses focus", () => {
    const { result } = renderHook(() => useSettingsDisclosure());
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);
    act(() => {
      fireEvent.blur(window);
    });
    expect(result.current.open).toBe(false);
  });

  it("stays closed on blur when it was never open", () => {
    const { result } = renderHook(() => useSettingsDisclosure());
    act(() => {
      fireEvent.blur(window);
    });
    expect(result.current.open).toBe(false);
  });
});

describe("useWindowFocus", () => {
  it("follows the window's focus and blur events", () => {
    const { result } = renderHook(() => useWindowFocus());
    act(() => {
      fireEvent.blur(window);
    });
    expect(result.current).toBe(false);
    act(() => {
      fireEvent.focus(window);
    });
    expect(result.current).toBe(true);
  });
});
