import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_WATERMARK_CONFIG } from "./watermark";
import { useWatermark } from "./use-watermark";

describe("useWatermark", () => {
  it("defaults to enabled (free user) with the default config", () => {
    // No VITE_WATERMARK_FORCE in the test env → real (stubbed free) entitlement.
    const { result } = renderHook(() => useWatermark());
    expect(result.current.enabled).toBe(true);
    expect(result.current.config).toEqual(DEFAULT_WATERMARK_CONFIG);
  });
});
