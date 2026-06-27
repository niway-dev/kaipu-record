import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WATERMARK_CONFIG } from "./watermark";
import { writeDevSimulatePaid } from "./dev-override";
import { useWatermark } from "./use-watermark";

vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: vi.fn(() => true),
}));

import { useFlag } from "@renderer/features/analytics/use-flag";

describe("useWatermark", () => {
  beforeEach(() => {
    vi.mocked(useFlag).mockReturnValue(true);
  });

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

  it("disables the watermark when the watermark-enabled flag is off", () => {
    vi.mocked(useFlag).mockReturnValue(false);
    const { result } = renderHook(() => useWatermark());
    expect(result.current.enabled).toBe(false);
  });
});
