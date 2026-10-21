import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type {
  OpenSavedScreenshotRequest,
  QuietCaptureHandOff,
} from "@shared/types/screenshot-capture";

const openCapture = vi.fn();
const navigate = vi.fn();
vi.mock("@renderer/features/editor/open-in-editor", () => ({
  useOpenInEditor: () => ({ openCapture }),
}));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

const { useCaptureToastHandOffs } = await import("./use-capture-toast-hand-offs");

function stubApi() {
  let saved: ((request: OpenSavedScreenshotRequest) => void) | null = null;
  let quiet: ((capture: QuietCaptureHandOff) => void) | null = null;
  const revealAfterCapture = vi.fn();
  window.electronAPI = {
    ...window.electronAPI,
    revealAfterCapture,
    onOpenSavedScreenshot: (callback) => {
      saved = callback;
      return () => (saved = null);
    },
    onOpenQuietCapture: (callback) => {
      quiet = callback;
      return () => (quiet = null);
    },
  } as typeof window.electronAPI;
  return {
    revealAfterCapture,
    openSaved: (request: OpenSavedScreenshotRequest) => saved?.(request),
    openQuiet: (capture: QuietCaptureHandOff) => quiet?.(capture),
    subscribed: () => saved !== null && quiet !== null,
  };
}

describe("useCaptureToastHandOffs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens a saved shot in the image editor, then reveals the window", () => {
    const api = stubApi();
    renderHook(() => useCaptureToastHandOffs());
    api.openSaved({ target: "editor", assetId: "asset-1" });
    expect(navigate).toHaveBeenCalledWith("/editor/image/asset-1");
    expect(api.revealAfterCapture).toHaveBeenCalledTimes(1);
    expect(navigate.mock.invocationCallOrder[0]).toBeLessThan(
      api.revealAfterCapture.mock.invocationCallOrder[0]!,
    );
  });

  it("opens a saved shot's Library page", () => {
    const api = stubApi();
    renderHook(() => useCaptureToastHandOffs());
    api.openSaved({ target: "library", assetId: "asset-1" });
    expect(navigate).toHaveBeenCalledWith("/library/asset-1");
    expect(api.revealAfterCapture).toHaveBeenCalledTimes(1);
  });

  it("opens copy-only bytes as a quiet blob so the editor neither saves nor copies again", () => {
    const api = stubApi();
    renderHook(() => useCaptureToastHandOffs());
    const png = new ArrayBuffer(4);
    api.openQuiet({ png, width: 1126, height: 604, mode: "frame" });
    expect(openCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "blob",
        origin: "quiet",
        bytes: png,
        width: 1126,
        height: 604,
      }),
    );
    expect(api.revealAfterCapture).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes on unmount", () => {
    const api = stubApi();
    const { unmount } = renderHook(() => useCaptureToastHandOffs());
    expect(api.subscribed()).toBe(true);
    unmount();
    expect(api.subscribed()).toBe(false);
  });
});
