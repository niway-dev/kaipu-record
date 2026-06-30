import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useImageSource } from "./use-image-source";

describe("useImageSource", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns null for a null source", () => {
    const { result } = renderHook(() => useImageSource(null));
    expect(result.current).toBeNull();
  });

  it("dispatches a local source to the media-protocol reader", () => {
    const { result } = renderHook(() =>
      useImageSource({ kind: "local", id: "shot-1", width: 1, height: 1 }),
    );
    expect(result.current?.displayUrl).toBe("kaipu-media://screenshot/shot-1");
  });

  it("creates a blob URL for a blob source and revokes it on unmount", () => {
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const source = {
      kind: "blob" as const,
      bytes: new Uint8Array([1, 2, 3]).buffer,
      width: 1,
      height: 1,
    };
    const { result, unmount } = renderHook(() => useImageSource(source));

    expect(result.current?.displayUrl).toBe("blob:fake");
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  it("exposes a getBytes function on the resolved image", () => {
    // A local source resolves without URL.createObjectURL (absent in jsdom).
    const { result } = renderHook(() =>
      useImageSource({ kind: "local", id: "shot-9", width: 1, height: 1 }),
    );
    expect(typeof result.current?.getBytes).toBe("function");
  });
});
