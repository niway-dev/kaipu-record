import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/types";
import { DEFAULT_WATERMARK_CONFIG } from "./watermark";
import { useWatermark } from "./use-watermark";

describe("useWatermark", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is off by default with the default config — no watermark on the free app", async () => {
    vi.spyOn(window.electronAPI, "getSettings").mockResolvedValue(DEFAULT_SETTINGS);
    const { result } = renderHook(() => useWatermark());
    expect(result.current.enabled).toBe(false);
    expect(result.current.config).toEqual(DEFAULT_WATERMARK_CONFIG);
    await waitFor(() => expect(window.electronAPI.getSettings).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.enabled).toBe(false);
  });

  it("turns on when the user enables the 'Made with Kaipu' badge", async () => {
    vi.spyOn(window.electronAPI, "getSettings").mockResolvedValue({
      ...DEFAULT_SETTINGS,
      showBrandBadge: true,
    });
    const { result } = renderHook(() => useWatermark());
    await waitFor(() => expect(result.current.enabled).toBe(true));
  });

  it("stays off while the settings round-trip is unresolved", () => {
    vi.spyOn(window.electronAPI, "getSettings").mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useWatermark());
    expect(result.current.enabled).toBe(false);
  });
});
