import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WATERMARK_CONFIG } from "./watermark";
import { writeDevSimulatePaid } from "./dev-override";
import { useWatermark } from "./use-watermark";
import { FREE_ENTITLEMENTS, type Entitlements } from "@shared/entitlements";

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
    vi.restoreAllMocks();
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

  it("removes the watermark for an account whose entitlements grant it", async () => {
    const pro: Entitlements = {
      plan: "pro",
      status: "active",
      currentPeriodEnd: null,
      features: { watermarkRemoval: true },
    };
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({
      kind: "signed-in",
      email: "a@b.com",
      name: "A",
      entitlements: pro,
    });
    const { result } = renderHook(() => useWatermark());
    await waitFor(() => expect(result.current.enabled).toBe(false));
  });

  it("keeps the watermark for a signed-in free account", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({
      kind: "signed-in",
      email: "a@b.com",
      name: "A",
      entitlements: FREE_ENTITLEMENTS,
    });
    const { result } = renderHook(() => useWatermark());
    // Resolve the status round-trip before asserting, so this is not just the initial render.
    await waitFor(() => expect(window.electronAPI.getAuthStatus).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.enabled).toBe(true);
  });

  it("disables the watermark when the watermark-enabled flag is off", () => {
    vi.mocked(useFlag).mockReturnValue(false);
    const { result } = renderHook(() => useWatermark());
    expect(result.current.enabled).toBe(false);
  });
});
