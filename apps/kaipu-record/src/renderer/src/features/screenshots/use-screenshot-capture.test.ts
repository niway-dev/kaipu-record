import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { CaptureResult } from "@shared/types/screenshot-capture";

const openCapture = vi.fn();
const openScreenshot = vi.fn();
const showToast = vi.fn();

vi.mock("@renderer/features/editor/open-in-editor", () => ({
  useOpenInEditor: () => ({ openCapture, openScreenshot }),
}));
vi.mock("@renderer/ui/toast-store", () => ({ showToast: (spec: unknown) => showToast(spec) }));
let recorderStatus = "idle";
vi.mock("@renderer/features/recording/recorder-store", () => ({
  getRecorderSnapshot: () => ({ status: recorderStatus }),
}));
vi.mock("@kaipu/i18n", () => ({
  useTranslations: () => (key: string) => key,
}));

const { useScreenshotCapture } = await import("./use-screenshot-capture");

function stubApi(result: CaptureResult) {
  const captureScreenshot = vi.fn(async () => result);
  const revealAfterCapture = vi.fn();
  window.electronAPI = {
    ...window.electronAPI,
    captureScreenshot,
    revealAfterCapture,
  } as typeof window.electronAPI;
  return { captureScreenshot, revealAfterCapture };
}

describe("useScreenshotCapture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recorderStatus = "idle";
  });

  describe("while the recorder is busy", () => {
    const modes = ["frame", "window", "screen"] as const;
    const statuses = ["counting", "starting", "recording", "paused", "finalizing"];
    for (const status of statuses) {
      it.each(modes)(`${status}: %s toasts and never calls captureScreenshot`, async (mode) => {
        recorderStatus = status;
        const api = stubApi({ kind: "cancelled" });
        const { result } = renderHook(() => useScreenshotCapture());
        await act(() => result.current.capture(mode));
        expect(showToast).toHaveBeenCalledWith({ message: "captureWhileRecording" });
        expect(api.captureScreenshot).not.toHaveBeenCalled();
        expect(openCapture).not.toHaveBeenCalled();
      });
    }
  });

  it("opens the saved shot in the editor and reveals the app, defaulting to frame", async () => {
    const api = stubApi({
      kind: "captured",
      after: "editor",
      saved: { id: "screenshot-1", assetId: "asset-1" },
      copied: false,
      png: new ArrayBuffer(0),
      width: 10,
      height: 5,
      mode: "frame",
    });
    const { result } = renderHook(() => useScreenshotCapture());
    await act(() => result.current.capture());
    expect(api.captureScreenshot).toHaveBeenCalledWith("frame");
    expect(openScreenshot).toHaveBeenCalledExactlyOnceWith("asset-1");
    expect(openCapture).not.toHaveBeenCalled();
    expect(api.revealAfterCapture).toHaveBeenCalled();
  });

  it("opens the bytes in memory when main could not save the shot", async () => {
    const api = stubApi({
      kind: "captured",
      after: "editor",
      saved: null,
      copied: false,
      png: new ArrayBuffer(4),
      width: 10,
      height: 5,
      mode: "frame",
    });
    const { result } = renderHook(() => useScreenshotCapture());
    await act(() => result.current.capture());
    expect(openCapture).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "blob", width: 10, height: 5 }),
    );
    expect(openScreenshot).not.toHaveBeenCalled();
    expect(api.revealAfterCapture).toHaveBeenCalled();
  });

  it("never opens the editor nor force-shows the window on a Copy", async () => {
    const api = stubApi({
      kind: "captured",
      after: "quiet",
      saved: { id: "screenshot-1", assetId: "asset-1" },
      copied: true,
      png: new ArrayBuffer(0),
      width: 10,
      height: 5,
      mode: "frame",
    });
    const { result } = renderHook(() => useScreenshotCapture());
    await act(() => result.current.capture());
    expect(openCapture).not.toHaveBeenCalled();
    expect(openScreenshot).not.toHaveBeenCalled();
    // Main restored the window to its pre-capture state; a reveal would undo that.
    expect(api.revealAfterCapture).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("does nothing on cancelled", async () => {
    const api = stubApi({ kind: "cancelled" });
    const { result } = renderHook(() => useScreenshotCapture());
    await act(() => result.current.capture("screen"));
    expect(api.captureScreenshot).toHaveBeenCalledWith("screen");
    expect(openCapture).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(api.revealAfterCapture).not.toHaveBeenCalled();
  });

  it("toasts the Windows message on unsupported", async () => {
    const api = stubApi({ kind: "unsupported", mode: "frame", platform: "win32" });
    const { result } = renderHook(() => useScreenshotCapture());
    await act(() => result.current.capture());
    expect(showToast).toHaveBeenCalledWith({ message: "captureUnsupportedWindows" });
    expect(api.revealAfterCapture).toHaveBeenCalled();
    expect(openCapture).not.toHaveBeenCalled();
  });

  it("toasts the generic message on another platform", async () => {
    stubApi({ kind: "unsupported", mode: "frame", platform: "linux" });
    const { result } = renderHook(() => useScreenshotCapture());
    await act(() => result.current.capture());
    expect(showToast).toHaveBeenCalledWith({ message: "captureUnsupported" });
  });
});
