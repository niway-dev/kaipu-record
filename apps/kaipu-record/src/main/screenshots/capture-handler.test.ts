import { describe, expect, it, vi } from "vitest";
import { createCaptureHandler } from "./capture-handler";
import type { OverlayPort } from "./overlay-port";
import type { ProviderResult, ScreenshotCaptureProvider } from "./screenshot-capture";

const overlay: OverlayPort = {
  pick: async () => ({ kind: "cancelled" }),
  hideAll: async () => {},
  destroyAll: () => {},
};

function setup(
  capture: ScreenshotCaptureProvider["capture"],
  platform: NodeJS.Platform = "darwin",
  supports: (mode: string) => boolean = () => true,
) {
  const windows = { beforeCapture: vi.fn(), afterCapture: vi.fn(), reveal: vi.fn() };
  const track = vi.fn();
  const handler = createCaptureHandler({
    platform,
    provider: { capture, supports, supportedModes: () => [] },
    overlay,
    windows,
    measure: () => ({ width: 3, height: 2 }),
    displayCount: () => 2,
    track,
  });
  return { handler, windows, track };
}

describe("createCaptureHandler", () => {
  it("answers captured with an ArrayBuffer copy, size and mode", async () => {
    const { handler, windows } = setup(async ({ mode }) => ({
      kind: "captured",
      png: Buffer.from([1, 2, 3]),
      mode,
      action: "capture",
    }));
    const out = await handler({ mode: "frame" });
    expect(out).toMatchObject({ kind: "captured", width: 3, height: 2, mode: "frame" });
    if (out.kind !== "captured") throw new Error("unreachable");
    expect(new Uint8Array(out.png)).toEqual(new Uint8Array([1, 2, 3]));
    expect(windows.afterCapture).toHaveBeenCalledWith(true);
  });

  it("answers cancelled and restores the window", async () => {
    const { handler, windows } = setup(async () => ({ kind: "cancelled" }));
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
    expect(windows.afterCapture).toHaveBeenCalledWith(false);
  });

  it("answers unsupported with the platform it ran on", async () => {
    const capture = vi.fn();
    const { handler, windows } = setup(capture, "win32", () => false);
    expect(await handler({ mode: "screen" })).toEqual({
      kind: "unsupported",
      mode: "screen",
      platform: "win32",
    });
    // The app window must not flicker for an answer that needs no capture.
    expect(windows.beforeCapture).not.toHaveBeenCalled();
    expect(windows.afterCapture).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("reports one event per answered request with only mode, platform, displays and outcome", async () => {
    const captured = setup(async ({ mode }) => ({
      kind: "captured",
      png: Buffer.from([1]),
      mode,
      action: "capture",
    }));
    await captured.handler({ mode: "screen" });
    expect(captured.track).toHaveBeenCalledOnce();
    expect(captured.track).toHaveBeenCalledWith({
      mode: "screen",
      platform: "darwin",
      displays: 2,
      outcome: "captured",
    });

    const cancelled = setup(async () => ({ kind: "cancelled" }));
    await cancelled.handler({ mode: "frame" });
    expect(cancelled.track).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "frame", outcome: "cancelled" }),
    );

    const unsupported = setup(vi.fn(), "win32", () => false);
    await unsupported.handler({ mode: "frame" });
    expect(unsupported.track).toHaveBeenCalledWith({
      mode: "frame",
      platform: "win32",
      displays: 2,
      outcome: "unsupported",
    });
  });

  it("does not report the re-entrant request it turns away, nor an invalid mode", async () => {
    let finish!: (r: ProviderResult) => void;
    const { handler, track } = setup(() => new Promise<ProviderResult>((r) => (finish = r)));
    const first = handler({ mode: "frame" });
    await handler({ mode: "frame" });
    expect(track).not.toHaveBeenCalled();
    finish({ kind: "cancelled" });
    await first;
    expect(track).toHaveBeenCalledOnce();
    await expect(handler({ mode: "area" })).rejects.toThrow();
    expect(track).toHaveBeenCalledOnce();
  });

  it("still answers when analytics throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler, track } = setup(async () => ({ kind: "cancelled" }));
    track.mockImplementation(() => {
      throw new Error("posthog down");
    });
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
    expect(logged).toHaveBeenCalled();
  });

  it("rejects an unknown mode before touching the windows", async () => {
    const capture = vi.fn();
    const { handler, windows } = setup(capture);
    await expect(handler({ mode: "area" })).rejects.toThrow(/unknown mode/);
    await expect(handler(undefined)).rejects.toThrow(/unknown mode/);
    expect(windows.beforeCapture).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("answers cancelled to a second request while one is in flight, leaving the first alone", async () => {
    let finish!: (r: ProviderResult) => void;
    const capture = vi.fn(() => new Promise<ProviderResult>((resolve) => (finish = resolve)));
    const { handler, windows } = setup(capture);

    const first = handler({ mode: "frame" });
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(windows.beforeCapture).toHaveBeenCalledTimes(1);
    expect(windows.afterCapture).not.toHaveBeenCalled();

    finish({ kind: "cancelled" });
    await first;
    expect(windows.afterCapture).toHaveBeenCalledTimes(1);

    // The guard is released afterwards.
    finish = () => {};
    void handler({ mode: "frame" });
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("releases the guard and restores the window when hiding the windows throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const capture = vi.fn().mockResolvedValue({ kind: "cancelled" });
    const { handler, windows } = setup(capture);
    windows.beforeCapture.mockImplementationOnce(() => {
      throw new Error("hide failed");
    });
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
    expect(logged).toHaveBeenCalled();
    expect(windows.afterCapture).toHaveBeenCalledWith(false);
    expect(capture).not.toHaveBeenCalled();
    // The next request is not turned away by a stuck guard.
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("answers cancelled, logs, releases the guard and restores the window when the provider throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const capture = vi.fn().mockRejectedValueOnce(new Error("boom"));
    const { handler, windows } = setup(capture);
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
    expect(logged).toHaveBeenCalled();
    expect(windows.afterCapture).toHaveBeenCalledWith(false);
    capture.mockResolvedValueOnce({ kind: "cancelled" });
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
  });

  it("reports a provider throw as failed, not cancelled", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler, track } = setup(vi.fn().mockRejectedValueOnce(new Error("boom")));
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
    expect(track).toHaveBeenCalledOnce();
    expect(track).toHaveBeenCalledWith({
      mode: "frame",
      platform: "darwin",
      displays: 2,
      outcome: "failed",
    });
  });
});
