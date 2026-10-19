import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenshotCopyMode, ScreenshotSaveMode } from "@shared/types";
import type { CaptureAction } from "@shared/types/screenshot-capture";
import { createCaptureHandler } from "./capture-handler";
import { clearLastQuietCapture, takeLastQuietCapture } from "./last-quiet-capture";
import type { OverlayPort } from "./overlay-port";
import {
  MacProvider,
  type ProviderResult,
  type ScreenshotCaptureProvider,
} from "./screenshot-capture";

const overlay: OverlayPort = {
  pick: async () => ({ kind: "cancelled" }),
  hideAll: async () => {},
  destroyAll: () => {},
};

// The default preferences keep the editor path: saving manual means Capture opens it.
let prefs: { save: ScreenshotSaveMode; copy: ScreenshotCopyMode } = {
  save: "manual",
  copy: "manual",
};
beforeEach(() => {
  prefs = { save: "manual", copy: "manual" };
  clearLastQuietCapture();
});

function setup(
  capture: ScreenshotCaptureProvider["capture"],
  platform: NodeJS.Platform = "darwin",
  supports: (mode: string) => boolean = () => true,
) {
  const windows = { beforeCapture: vi.fn(), afterCapture: vi.fn(), reveal: vi.fn() };
  const track = vi.fn();
  const rememberMode = vi.fn();
  const saveToVault = vi.fn(async (_png: Buffer, _title: string) => ({ id: "screenshot-1" }));
  const copyToClipboard = vi.fn();
  const onQuietCapture = vi.fn();
  const handler = createCaptureHandler({
    platform,
    provider: { capture, supports, supportedModes: () => [] },
    overlay,
    windows,
    measure: () => ({ width: 3, height: 2 }),
    displayCount: () => 2,
    track,
    rememberMode,
    settings: () => prefs,
    saveToVault,
    copyToClipboard,
    thumbnail: () => "data:image/png;base64,thumb",
    onQuietCapture,
  });
  return { handler, windows, track, rememberMode, saveToVault, copyToClipboard, onQuietCapture };
}

describe("createCaptureHandler", () => {
  it("makes the mode the overlay captured with the current one, only on a captured result", async () => {
    // The user opened Frame and switched to Screen on the overlay before capturing.
    const { handler, rememberMode } = setup(async () => ({
      kind: "captured",
      png: Buffer.from([1]),
      mode: "screen",
      action: "copy",
    }));
    await handler({ mode: "frame" });
    expect(rememberMode).toHaveBeenCalledExactlyOnceWith("screen");
  });

  it("leaves the current mode untouched after a cancelled pick (Esc)", async () => {
    const { handler, rememberMode } = setup(async () => ({ kind: "cancelled" }));
    await handler({ mode: "window" });
    expect(rememberMode).not.toHaveBeenCalled();
  });

  it("answers unsupported for a window request when Window is disabled", async () => {
    const capture = vi.fn();
    const { handler } = setup(capture, "darwin", (mode) =>
      new MacProvider().supports(mode as never),
    );
    expect(await handler({ mode: "window" })).toMatchObject({
      kind: "unsupported",
      mode: "window",
    });
    expect(capture).not.toHaveBeenCalled();
  });

  it("leaves the current mode untouched when the capture is unsupported or throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unsupported = setup(async () => ({ kind: "unsupported", mode: "window" }));
    await unsupported.handler({ mode: "frame" });
    expect(unsupported.rememberMode).not.toHaveBeenCalled();
    // Nothing opened: the window comes back as after a cancel.
    expect(unsupported.windows.afterCapture).toHaveBeenCalledWith("cancelled");

    const thrown = setup(vi.fn().mockRejectedValueOnce(new Error("boom")));
    await thrown.handler({ mode: "frame" });
    expect(thrown.rememberMode).not.toHaveBeenCalled();
  });

  it("still answers the capture when remembering the mode fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler, rememberMode } = setup(async () => ({
      kind: "captured",
      png: Buffer.from([1]),
      mode: "frame",
      action: "capture",
    }));
    rememberMode.mockImplementation(() => {
      throw new Error("disk full");
    });
    expect(await handler({ mode: "frame" })).toMatchObject({ kind: "captured", mode: "frame" });
  });

  it("answers captured with an ArrayBuffer copy, size and mode", async () => {
    const { handler, windows } = setup(async ({ mode }) => ({
      kind: "captured",
      png: Buffer.from([1, 2, 3]),
      mode,
      action: "capture",
    }));
    const out = await handler({ mode: "frame" });
    expect(out).toMatchObject({
      kind: "captured",
      after: "editor",
      saved: null,
      copied: false,
      width: 3,
      height: 2,
      mode: "frame",
    });
    if (out.kind !== "captured") throw new Error("unreachable");
    expect(new Uint8Array(out.png)).toEqual(new Uint8Array([1, 2, 3]));
    expect(windows.afterCapture).toHaveBeenCalledWith("editor");
  });

  it("answers cancelled and restores the window", async () => {
    const { handler, windows } = setup(async () => ({ kind: "cancelled" }));
    expect(await handler({ mode: "frame" })).toEqual({ kind: "cancelled" });
    expect(windows.afterCapture).toHaveBeenCalledWith("cancelled");
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
      after: "editor",
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
    expect(windows.afterCapture).toHaveBeenCalledWith("cancelled");
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
    expect(windows.afterCapture).toHaveBeenCalledWith("cancelled");
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

  describe("quiet capture", () => {
    const shot = (action: CaptureAction) =>
      vi.fn(async ({ mode }: { mode: "frame" | "window" | "screen" }) => ({
        kind: "captured" as const,
        png: Buffer.from([9, 8, 7]),
        mode,
        action,
      }));

    it("saves exactly one vault item, answers its id and ships no bytes", async () => {
      prefs = { save: "auto", copy: "manual" };
      const { handler, saveToVault, copyToClipboard, windows } = setup(shot("capture"));
      const out = await handler({ mode: "frame" });
      expect(saveToVault).toHaveBeenCalledOnce();
      expect(saveToVault.mock.calls[0]![0]).toEqual(Buffer.from([9, 8, 7]));
      expect(saveToVault.mock.calls[0]![1]).toMatch(/^Screenshot — /);
      expect(copyToClipboard).not.toHaveBeenCalled();
      expect(out).toMatchObject({
        kind: "captured",
        after: "quiet",
        saved: { id: "screenshot-1" },
        copied: false,
        width: 3,
        height: 2,
        mode: "frame",
      });
      if (out.kind !== "captured") throw new Error("unreachable");
      expect(out.png.byteLength).toBe(0);
      // The editor will not open: the main window goes back where it was.
      expect(windows.afterCapture).toHaveBeenCalledWith("quiet");
      // A saved shot is annotated from the vault, so nothing is kept in memory.
      expect(takeLastQuietCapture()).toBeNull();
    });

    it("copies when both preferences are automatic", async () => {
      prefs = { save: "auto", copy: "auto" };
      const { handler, saveToVault, copyToClipboard } = setup(shot("capture"));
      const out = await handler({ mode: "screen" });
      expect(saveToVault).toHaveBeenCalledOnce();
      expect(copyToClipboard).toHaveBeenCalledWith(Buffer.from([9, 8, 7]));
      expect(out).toMatchObject({ after: "quiet", saved: { id: "screenshot-1" }, copied: true });
    });

    it("Copy with saving manual only copies, never writes the vault, and keeps the bytes once", async () => {
      const { handler, saveToVault, copyToClipboard, windows } = setup(shot("copy"));
      const out = await handler({ mode: "window" });
      expect(saveToVault).not.toHaveBeenCalled();
      expect(copyToClipboard).toHaveBeenCalledOnce();
      // Quiet, not cancelled: the window comes back without taking the focus from the app.
      expect(windows.afterCapture).toHaveBeenCalledExactlyOnceWith("quiet");
      expect(out).toMatchObject({ after: "quiet", saved: null, copied: true, mode: "window" });
      expect(takeLastQuietCapture()).toEqual({
        png: Buffer.from([9, 8, 7]),
        width: 3,
        height: 2,
        mode: "window",
      });
      expect(takeLastQuietCapture()).toBeNull();
    });

    it("Copy with saving automatic writes the vault once and keeps nothing", async () => {
      prefs = { save: "auto", copy: "manual" };
      const { handler, saveToVault } = setup(shot("copy"));
      const out = await handler({ mode: "frame" });
      expect(saveToVault).toHaveBeenCalledOnce();
      expect(out).toMatchObject({ saved: { id: "screenshot-1" }, copied: true });
      expect(takeLastQuietCapture()).toBeNull();
    });

    it("a new capture replaces the kept bytes, and starting one frees them", async () => {
      const first = setup(shot("copy"));
      await first.handler({ mode: "frame" });
      const second = setup(
        vi.fn(async ({ mode }) => ({
          kind: "captured" as const,
          png: Buffer.from([4]),
          mode,
          action: "copy" as const,
        })),
      );
      await second.handler({ mode: "frame" });
      expect(takeLastQuietCapture()?.png).toEqual(Buffer.from([4]));

      await first.handler({ mode: "frame" });
      const cancelled = setup(async () => ({ kind: "cancelled" }));
      await cancelled.handler({ mode: "frame" });
      expect(takeLastQuietCapture()).toBeNull();
    });

    it("hands the toast hook one payload per quiet capture", async () => {
      prefs = { save: "auto", copy: "auto" };
      const { handler, onQuietCapture } = setup(shot("capture"));
      await handler({ mode: "frame" });
      expect(onQuietCapture).toHaveBeenCalledOnce();
      expect(onQuietCapture).toHaveBeenCalledWith({
        thumbnail: "data:image/png;base64,thumb",
        width: 3,
        height: 2,
        mode: "frame",
        saved: { id: "screenshot-1" },
        copied: true,
      });
    });

    it("does not call the toast hook for an editor capture", async () => {
      const { handler, onQuietCapture } = setup(shot("capture"));
      await handler({ mode: "frame" });
      expect(onQuietCapture).not.toHaveBeenCalled();
    });

    it("reports after: quiet, with the mode the user ended in", async () => {
      prefs = { save: "auto", copy: "manual" };
      const { handler, track } = setup(shot("capture"));
      await handler({ mode: "frame" });
      expect(track).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "captured", after: "quiet" }),
      );
    });

    it("falls back to the editor with the bytes when the vault write fails and nothing else succeeded", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      prefs = { save: "auto", copy: "manual" };
      const { handler, saveToVault, windows, onQuietCapture } = setup(shot("capture"));
      saveToVault.mockRejectedValueOnce(new Error("disk full"));
      const out = await handler({ mode: "frame" });
      if (out.kind !== "captured") throw new Error("unreachable");
      expect(out.after).toBe("editor");
      expect(new Uint8Array(out.png)).toEqual(new Uint8Array([9, 8, 7]));
      expect(windows.afterCapture).toHaveBeenCalledWith("editor");
      expect(onQuietCapture).not.toHaveBeenCalled();
    });

    it("remembers the mode on a quiet capture and on a failed vault write that falls back to the editor", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      prefs = { save: "auto", copy: "manual" };
      const quiet = setup(shot("capture"));
      await quiet.handler({ mode: "screen" });
      expect(quiet.rememberMode).toHaveBeenCalledExactlyOnceWith("screen");

      const fallback = setup(shot("capture"));
      fallback.saveToVault.mockRejectedValueOnce(new Error("disk full"));
      const out = await fallback.handler({ mode: "window" });
      expect(out).toMatchObject({ kind: "captured", after: "editor" });
      expect(fallback.rememberMode).toHaveBeenCalledExactlyOnceWith("window");
    });
  });
});
