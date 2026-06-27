import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_WATERMARK_CONFIG } from "./watermark";
import { writeDevSimulatePaid } from "./dev-override";
import { useWatermark } from "./use-watermark";

describe("useWatermark", () => {
  afterEach(() => {
    writeDevSimulatePaid(false);
  });

  it("defaults to enabled (free user) with the default config", () => {
    const { result } = renderHook(() => useWatermark());
    expect(result.current.enabled).toBe(true);
    expect(result.current.config).toEqual(DEFAULT_WATERMARK_CONFIG);
  });

  it("the dev 'simulate paid' toggle removes the watermark", () => {
    // Vitest runs in dev mode, so the dev override is honoured (it would be a no-op
    // in a production build).
    writeDevSimulatePaid(true);
    const { result } = renderHook(() => useWatermark());
    expect(result.current.enabled).toBe(false);
  });
});
