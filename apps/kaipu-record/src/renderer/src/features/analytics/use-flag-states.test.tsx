import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FLAG_DEFAULTS, FLAG_NAMES } from "@shared/analytics";

describe("useFlagRows", () => {
  it("lists every flag with its source, and follows a live override", async () => {
    vi.resetModules();
    const api = window.electronAPI as unknown as { onFlagOverridesChanged: unknown };
    const original = api.onFlagOverridesChanged;
    let push: (overrides: Record<string, boolean>) => void = () => {};
    api.onFlagOverridesChanged = (listener: typeof push) => {
      push = listener;
      return () => {};
    };
    try {
      const { useFlagRows, useAnyFlagOverridden } = await import("./use-flag-states");
      const rows = renderHook(() => useFlagRows());
      const any = renderHook(() => useAnyFlagOverridden());

      expect(rows.result.current.map((row) => row.name)).toEqual([...FLAG_NAMES]);
      expect(rows.result.current.every((row) => row.source === "default")).toBe(true);
      expect(rows.result.current.find((row) => row.name === "image-canvas")?.value).toBe(
        FLAG_DEFAULTS["image-canvas"],
      );
      expect(any.result.current).toBe(false);

      act(() => push({ "image-canvas": !FLAG_DEFAULTS["image-canvas"] }));

      const pinned = rows.result.current.find((row) => row.name === "image-canvas");
      expect(pinned).toEqual({
        name: "image-canvas",
        value: !FLAG_DEFAULTS["image-canvas"],
        source: "override",
      });
      expect(any.result.current).toBe(true);

      act(() => push({}));
      expect(any.result.current).toBe(false);
    } finally {
      api.onFlagOverridesChanged = original;
    }
  });
});
