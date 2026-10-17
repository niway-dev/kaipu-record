import { describe, expect, it, vi } from "vitest";
import { createCaptureHandler } from "./capture-handler";
import type { OverlayPort } from "./overlay-port";
import type { ProviderResult, ScreenshotCaptureProvider } from "./screenshot-capture";

const overlay: OverlayPort = { pick: async () => ({ kind: "cancelled" }) };

function setup(
  capture: ScreenshotCaptureProvider["capture"],
  platform: NodeJS.Platform = "darwin",
) {
  const windows = { beforeCapture: vi.fn(), afterCapture: vi.fn(), reveal: vi.fn() };
  const handler = createCaptureHandler({
    platform,
    provider: { capture },
    overlay,
    windows,
    measure: () => ({ width: 3, height: 2 }),
  });
  return { handler, windows };
}

describe("createCaptureHandler", () => {
  it("answers captured with an ArrayBuffer copy, size and mode", async () => {
    const { handler, windows } = setup(async ({ mode }) => ({
      kind: "captured",
      png: Buffer.from([1, 2, 3]),
      mode,
    }));
    const out = await handler({ mode: "area" });
    expect(out).toMatchObject({ kind: "captured", width: 3, height: 2, mode: "area" });
    if (out.kind !== "captured") throw new Error("unreachable");
    expect(new Uint8Array(out.png)).toEqual(new Uint8Array([1, 2, 3]));
    expect(windows.afterCapture).toHaveBeenCalledWith(true);
  });

  it("answers cancelled and restores the window", async () => {
    const { handler, windows } = setup(async () => ({ kind: "cancelled" }));
    expect(await handler({ mode: "area" })).toEqual({ kind: "cancelled" });
    expect(windows.afterCapture).toHaveBeenCalledWith(false);
  });

  it("answers unsupported with the platform it ran on", async () => {
    const { handler } = setup(async ({ mode }) => ({ kind: "unsupported", mode }), "win32");
    expect(await handler({ mode: "screen" })).toEqual({
      kind: "unsupported",
      mode: "screen",
      platform: "win32",
    });
  });

  it("rejects an unknown mode before touching the windows", async () => {
    const capture = vi.fn();
    const { handler, windows } = setup(capture);
    await expect(handler({ mode: "window" })).rejects.toThrow(/unknown mode/);
    await expect(handler(undefined)).rejects.toThrow(/unknown mode/);
    expect(windows.beforeCapture).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("answers cancelled to a second request while one is in flight, leaving the first alone", async () => {
    let finish!: (r: ProviderResult) => void;
    const capture = vi.fn(() => new Promise<ProviderResult>((resolve) => (finish = resolve)));
    const { handler, windows } = setup(capture);

    const first = handler({ mode: "area" });
    expect(await handler({ mode: "area" })).toEqual({ kind: "cancelled" });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(windows.beforeCapture).toHaveBeenCalledTimes(1);
    expect(windows.afterCapture).not.toHaveBeenCalled();

    finish({ kind: "cancelled" });
    await first;
    expect(windows.afterCapture).toHaveBeenCalledTimes(1);

    // The guard is released afterwards.
    finish = () => {};
    void handler({ mode: "area" });
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("releases the guard and restores the window when the provider throws", async () => {
    const capture = vi.fn().mockRejectedValueOnce(new Error("boom"));
    const { handler, windows } = setup(capture);
    await expect(handler({ mode: "area" })).rejects.toThrow("boom");
    expect(windows.afterCapture).toHaveBeenCalledWith(false);
    capture.mockResolvedValueOnce({ kind: "cancelled" });
    expect(await handler({ mode: "area" })).toEqual({ kind: "cancelled" });
  });
});
