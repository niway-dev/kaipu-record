import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFlag } from "./use-flag";

vi.mock("./analytics-client", () => ({
  isFlagEnabled: vi.fn((_name: string, fallback: boolean) => fallback),
  onFlagsChanged: vi.fn(() => () => {}),
}));

import { isFlagEnabled } from "./analytics-client";

afterEach(() => vi.clearAllMocks());

describe("useFlag", () => {
  it("returns the flag default when unresolved", () => {
    const { result } = renderHook(() => useFlag("watermark-enabled"));
    expect(result.current).toBe(true); // FLAG_DEFAULTS["watermark-enabled"]
  });

  it("reflects a resolved flag value", () => {
    vi.mocked(isFlagEnabled).mockReturnValue(false);
    const { result } = renderHook(() => useFlag("watermark-enabled"));
    expect(result.current).toBe(false);
  });
});
